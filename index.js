const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let EARLY_LAUNCH_CONFIG_DIR = null;

function getReposDir() {
  if (EARLY_LAUNCH_CONFIG_DIR) {
    return path.join(EARLY_LAUNCH_CONFIG_DIR, "repos");
  }
  
  // Fallback: guess based on argv if not set via earlyLaunch or input
  const isClaude = process.argv.join(' ').includes('claude');
  return path.join(require('os').homedir(), ".config", isClaude ? "claude" : "opencode", "repos");
}

function executeGit(command, cwd) {
  try {
    execSync(command, { cwd, stdio: "ignore" });
    return true;
  } catch (e) {
    console.error(`[Updater] Git error: ${e.message}`);
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
    const REPOS_DIR = getReposDir();
    const targetDir = path.join(REPOS_DIR, pluginName);
    
    if (!fs.existsSync(targetDir)) {
      if (!fs.existsSync(REPOS_DIR)) fs.mkdirSync(REPOS_DIR, { recursive: true });
      const branchFlag = branch ? `--branch ${branch}` : "";
      executeGit(`git clone --recurse-submodules ${branchFlag} ${gitUrl} ${pluginName}`, REPOS_DIR);
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
    const REPOS_DIR = getReposDir();
    const sourceDir = path.join(REPOS_DIR, pluginName);
    if (!fs.existsSync(sourceDir)) return false;

    if (fs.existsSync(path.join(sourceDir, "package.json"))) {
      try {
        execSync("npm install", { cwd: sourceDir, stdio: "ignore" });
        execSync("npm run build", { cwd: sourceDir, stdio: "ignore" });
      } catch (e) {}
    }

    const distPath = path.join(sourceDir, "dist");
    const deploySource = fs.existsSync(distPath) ? distPath : sourceDir;

    const pluginExecutionPath = (pluginName === "core-hub") 
        ? executionPath 
        : path.join(executionPath, pluginName);

    if (!fs.existsSync(pluginExecutionPath)) {
      fs.mkdirSync(pluginExecutionPath, { recursive: true });
    }

    try {
      fs.cpSync(deploySource, pluginExecutionPath, { recursive: true, force: true });
      return true;
    } catch (e) {
      console.error(`[Updater] Deploy failed: ${e.message}`);
      return false;
    }
  },

  rebuild: function(pluginObjOrName) {
    const REPOS_DIR = getReposDir();
    const pluginName = typeof pluginObjOrName === 'string' ? pluginObjOrName : pluginObjOrName.name;
    const targetDir = path.join(REPOS_DIR, pluginName);
    if (fs.existsSync(targetDir)) {
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (e) {}
    }
    return null;
  },

  disable: function(plugin) {
    try {
      // Use EARLY_LAUNCH_CONFIG_DIR if available, else fallback
      const configDir = EARLY_LAUNCH_CONFIG_DIR || path.dirname(getReposDir());
      const pluginExecutionPath = path.join(configDir, "plugin", plugin.name);
      if (fs.existsSync(pluginExecutionPath)) {
        fs.rmSync(pluginExecutionPath, { recursive: true, force: true });
      }
    } catch (e) {}
  },

  uninstall: function(plugin) {
    this.disable(plugin);
    const REPOS_DIR = getReposDir();
    const targetDir = path.join(REPOS_DIR, plugin.name);
    if (fs.existsSync(targetDir)) {
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (e) {}
    }
  },

  installLauncher: function() {
    this.updatePlugin("core-hub", "https://github.com/intisy/core-hub.git");
    this.updatePlugin("opencode-hub", "https://github.com/intisy/opencode-hub.git");
    this.updatePlugin("claude-hub", "https://github.com/intisy/claude-hub.git");
  }
};

// Main Plugin Entry Point for OpenCode/Claude Code
const pluginUpdaterEntry = async function(input) {
  // If not managed by the hub, run fallback updates!
  if (!global.__PLUGIN_UPDATER_HANDLED_BY_HUB__) {
    const configDir = (input && input.configDir) ? input.configDir : path.dirname(getReposDir());
    updaterAPI.earlyLaunch(configDir);

    updaterAPI.installLauncher();

    const pluginsJsonPath = path.join(configDir, "config", "plugins.json");
    if (fs.existsSync(pluginsJsonPath)) {
      try {
        const plugins = JSON.parse(fs.readFileSync(pluginsJsonPath, "utf-8"));
        for (const plugin of plugins) {
          if (plugin.url && plugin.enabled !== false && plugin.type !== "npm") {
            const branch = plugin.branch || null;
            const commit = plugin.commit || null;
            updaterAPI.updatePlugin(plugin.name, plugin.url, branch, commit);
            updaterAPI.deployToExecutionDir(plugin.name, path.join(configDir, "plugin"));
          }
        }
      } catch (e) {
        console.error("Failed to parse plugins.json", e);
      }
    }
  }

  return {}; // Return standard hooks object
};

// Attach API to the exported function
Object.assign(pluginUpdaterEntry, updaterAPI);

module.exports = pluginUpdaterEntry;
