const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

let EARLY_LAUNCH_CONFIG_DIR = null;

function getAppConfigDir(appName) {
  if (EARLY_LAUNCH_CONFIG_DIR) {
    return EARLY_LAUNCH_CONFIG_DIR;
  }
  const home = os.homedir();
  const directPath = path.join(home, `.${appName}`);
  const configPath = path.join(home, ".config", appName);
  return fs.existsSync(directPath) ? directPath : configPath;
}

function getReposDir() {
  const isClaude = process.argv.join(' ').includes('claude');
  const appName = isClaude ? "claude" : "opencode";
  return path.join(getAppConfigDir(appName), "repos");
}

function executeGit(command, cwd) {
  try {
    execSync(command, { cwd, stdio: "ignore" });
    return true;
  } catch (error) {
    console.error(`[Updater] Git error in ${cwd}: ${error.message}`);
    return false;
  }
}

const updaterAPI = {
  name: "plugin-updater",

  earlyLaunch: function(configDir) {
    EARLY_LAUNCH_CONFIG_DIR = configDir;
    global.__PLUGIN_UPDATER_HANDLED_BY_HUB__ = true;
  },

  updatePlugin: function(pluginName, gitUrl, branch = null, commitHash = null) {
    const reposDir = getReposDir();
    const targetDir = path.join(reposDir, pluginName);
    
    if (!fs.existsSync(targetDir)) {
      if (!fs.existsSync(reposDir)) fs.mkdirSync(reposDir, { recursive: true });
      const branchFlag = branch ? `--branch ${branch}` : "";
      executeGit(`git clone --recurse-submodules ${branchFlag} ${gitUrl} ${pluginName}`, reposDir);
    } else {
      executeGit("git fetch origin", targetDir);
      if (commitHash) {
        executeGit(`git checkout ${commitHash}`, targetDir);
      } else if (branch) {
        executeGit(`git checkout ${branch}`, targetDir);
        executeGit(`git pull --ff-only origin ${branch}`, targetDir);
      } else {
        executeGit("git checkout main || git checkout master", targetDir);
        executeGit("git pull --ff-only", targetDir);
      }
      executeGit("git submodule update --init --recursive", targetDir);
    }
    return true;
  },

  deployToExecutionDir: function(pluginName, executionPath) {
    const sourceDir = path.join(getReposDir(), pluginName);
    if (!fs.existsSync(sourceDir)) return false;

    if (fs.existsSync(path.join(sourceDir, "package.json"))) {
      try {
        execSync("npm install", { cwd: sourceDir, stdio: "ignore" });
        execSync("npm run build", { cwd: sourceDir, stdio: "ignore" });
      } catch (error) {
        console.error(`[Updater] Build failed for ${pluginName}: ${error.message}`);
      }
    }

    const distPath = path.join(sourceDir, "dist");
    const deploySource = fs.existsSync(distPath) ? distPath : sourceDir;
    const pluginExecutionPath = path.join(executionPath, pluginName);

    if (!fs.existsSync(pluginExecutionPath)) {
      fs.mkdirSync(pluginExecutionPath, { recursive: true });
    }

    try {
      fs.cpSync(deploySource, pluginExecutionPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.error(`[Updater] Deploy failed for ${pluginName}: ${error.message}`);
      return false;
    }
  },

  rebuild: function(pluginObjOrName) {
    const pluginName = typeof pluginObjOrName === 'string' ? pluginObjOrName : pluginObjOrName.name;
    const targetDir = path.join(getReposDir(), pluginName);
    if (fs.existsSync(targetDir)) {
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (e) {}
    }
    return null;
  },

  disable: function(plugin) {
    try {
      const configDir = EARLY_LAUNCH_CONFIG_DIR || path.dirname(getReposDir());
      const pluginExecutionPath = path.join(configDir, "plugin", plugin.name);
      if (fs.existsSync(pluginExecutionPath)) {
        fs.rmSync(pluginExecutionPath, { recursive: true, force: true });
      }
    } catch (e) {}
  },

  uninstall: function(plugin) {
    this.disable(plugin);
    const targetDir = path.join(getReposDir(), plugin.name);
    if (fs.existsSync(targetDir)) {
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (e) {}
    }
  },

  ensureHubInstalled: function(configDir) {
    const isClaude = configDir.includes("claude");
    const hubName = isClaude ? "claude-hub" : "opencode-hub";
    const hubUrl = `https://github.com/intisy/${hubName}.git`;
    
    const pluginsJsonPath = path.join(configDir, "config", "plugins.json");
    if (!fs.existsSync(path.dirname(pluginsJsonPath))) {
      fs.mkdirSync(path.dirname(pluginsJsonPath), { recursive: true });
    }

    let plugins = [];
    if (fs.existsSync(pluginsJsonPath)) {
      try { plugins = JSON.parse(fs.readFileSync(pluginsJsonPath, "utf-8")); } catch (e) {}
    }

    if (!plugins.some(p => p.name === hubName)) {
      plugins.push({ name: hubName, url: hubUrl, autoUpdate: true, enabled: true });
      fs.writeFileSync(pluginsJsonPath, JSON.stringify(plugins, null, 2), "utf-8");
    }
  }
};

const pluginUpdaterEntry = async function(input) {
  if (!global.__PLUGIN_UPDATER_HANDLED_BY_HUB__) {
    const configDir = (input && input.configDir) ? input.configDir : path.dirname(getReposDir());
    updaterAPI.earlyLaunch(configDir);
    updaterAPI.ensureHubInstalled(configDir);

    const pluginsJsonPath = path.join(configDir, "config", "plugins.json");
    if (fs.existsSync(pluginsJsonPath)) {
      try {
        const plugins = JSON.parse(fs.readFileSync(pluginsJsonPath, "utf-8"));
        for (const plugin of plugins) {
          if (plugin.url && plugin.enabled !== false && plugin.type !== "npm") {
            updaterAPI.updatePlugin(plugin.name, plugin.url, plugin.branch || null, plugin.commit || null);
            updaterAPI.deployToExecutionDir(plugin.name, path.join(configDir, "plugin"));
          }
        }
      } catch (e) {
        console.error("[Updater] Failed to parse plugins.json", e);
      }
    }
  }
  return {};
};

const apiMethods = { ...updaterAPI };
delete apiMethods.name;
Object.assign(pluginUpdaterEntry, apiMethods);
module.exports = pluginUpdaterEntry;
