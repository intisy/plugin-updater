import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

let EARLY_LAUNCH_CONFIG_DIR = null;
const START_TIME = new Date().toISOString().replace(/:/g, '-').split('.')[0];

function getAppConfigDir(appName) {
  if (EARLY_LAUNCH_CONFIG_DIR) {
    return EARLY_LAUNCH_CONFIG_DIR;
  }
  const home = os.homedir();
  const directPath = path.join(home, . + appName);
  const configPath = path.join(home, ".config", appName);
  return fs.existsSync(directPath) ? directPath : configPath;
}

function writeLog(message, isError = false) {
  try {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const isClaude = process.argv.join(' ').includes('claude');
    const appName = isClaude ? "claude" : "opencode";
    const configDir = getAppConfigDir(appName);

    const logsDir = path.join(configDir, "logs", dateStr);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const logFile = path.join(logsDir, updater- + START_TIME + .log);
    const prefix = isError ? "[ERROR]" : "[INFO]";
    const logMsg = [ + date.toISOString() + ]  + prefix +   + message + \n;

    fs.appendFileSync(logFile, logMsg);
  } catch (e) {
  }
  if (isError) console.error(message);
  else console.log(message);
}

function getReposDir() {
  const isClaude = process.argv.join(' ').includes('claude');
  const appName = isClaude ? "claude" : "opencode";
  return path.join(getAppConfigDir(appName), "repos");
}

function executeGit(command, cwd) {
  writeLog(Executing git:  + command +  in  + cwd);
  try {
    execSync(command, { 
      cwd, 
      stdio: "pipe",
      env: { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' }
    });
    return true;
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString().trim() : '';
    writeLog(Git error in  + cwd + :  + error.message +  | stderr:  + stderr, true);
    return false;
  }
}

function updatePlugin(pluginName, gitUrl, branch, commitHash) {
  const reposDir = getReposDir();
  const targetDir = path.join(reposDir, pluginName);
  let didChange = false;

  if (!fs.existsSync(targetDir)) {
    if (!fs.existsSync(reposDir)) fs.mkdirSync(reposDir, { recursive: true });
    const branchFlag = branch ? --branch  + branch : "";
    executeGit(git clone --recurse-submodules  + branchFlag +   + gitUrl +   + pluginName, reposDir);
    didChange = true;
  } else {
    executeGit("git fetch origin", targetDir);
    
    let beforeHash = "";
    try { beforeHash = execSync("git rev-parse HEAD", { cwd: targetDir }).toString().trim(); } catch(e) {}

    if (commitHash) {
      executeGit(git checkout  + commitHash, targetDir);
    } else if (branch) {
      executeGit(git checkout  + branch, targetDir);
      executeGit(git pull --ff-only origin  + branch, targetDir);
    } else {
      executeGit("git checkout main || git checkout master", targetDir);
      executeGit("git pull --ff-only", targetDir);
    }
    executeGit("git submodule update --init --recursive", targetDir);
    
    let afterHash = "";
    try { afterHash = execSync("git rev-parse HEAD", { cwd: targetDir }).toString().trim(); } catch(e) {}
    
    if (beforeHash !== afterHash) {
        didChange = true;
    }
  }
  return { success: true, changed: didChange };
}

function deployToExecutionDir(pluginName, executionPath, changed) {
  const sourceDir = path.join(getReposDir(), pluginName);
  if (!fs.existsSync(sourceDir)) return false;

  const packageJsonPath = path.join(sourceDir, "package.json");
  let entryFile = "index.js";
  const pluginExecutionFile = path.join(executionPath, pluginName + .js);

  // Fast path: if repo didn't change and the deployed plugin already exists, skip install/build
  if (!changed && fs.existsSync(pluginExecutionFile)) {
     writeLog(Skipping install/build for  + pluginName +  (no changes detected and deployed file exists));
  } else {
      if (fs.existsSync(packageJsonPath)) {
        try {
          writeLog(Running npm install for  + pluginName);
          execSync("npm install", { cwd: sourceDir, stdio: "ignore" });
          writeLog(Finished npm install for  + pluginName);

          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
          if (pkg.main) {
            entryFile = pkg.main;
          }

          if (pkg.scripts && pkg.scripts.build) {
            execSync("npm run build", { cwd: sourceDir, stdio: "ignore" });
            writeLog(Finished npm run build for  + pluginName);
          } else {
            writeLog(Skipped npm run build for  + pluginName +  (no build script found));
          }
        } catch (error) {
          writeLog(Build/Install failed for  + pluginName + :  + error.message, true);
        }
      }
  }

  // Always determine correct entry file even on skip, in case we need to copy
  if (fs.existsSync(packageJsonPath)) {
     try {
       const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
       if (pkg.main) entryFile = pkg.main;
     } catch(e) {}
  }

  const distPath = path.join(sourceDir, "dist");
  let deploySource = path.join(sourceDir, entryFile);

  if (fs.existsSync(path.join(distPath, entryFile))) {
    deploySource = path.join(distPath, entryFile);
  } else if (fs.existsSync(path.join(distPath, "index.js"))) {
    deploySource = path.join(distPath, "index.js");
  }

  if (!fs.existsSync(executionPath)) {
    fs.mkdirSync(executionPath, { recursive: true });
  }

  try {
    writeLog(Running copy for  + pluginName);
    fs.copyFileSync(deploySource, pluginExecutionFile);
    writeLog(Finished copy for  + pluginName);
  } catch (e) {
    writeLog(Copy failed for  + pluginName + :  + e.message, true);
  }
  return true;
}

async function pluginUpdaterEntry(input) {
  const isClaude = process.argv.join(' ').includes('claude');
  const appName = isClaude ? "claude" : "opencode";
  const configDir = getAppConfigDir(appName);

  const reposDir = path.join(configDir, "repos");
  const pluginsDir = path.join(configDir, "plugin");

  writeLog("Starting plugin updater for " + appName);

  if (input && input.action === "updatePlugin") {
    EARLY_LAUNCH_CONFIG_DIR = input.configDir;
    writeLog(Direct update request for  + input.pluginName);
    const updateResult = updatePlugin(input.pluginName, input.gitUrl, input.branch, input.commitHash);
    deployToExecutionDir(input.pluginName, pluginsDir, updateResult.changed);
    return;
  }
}

export function updatePluginPublic(pluginName, gitUrl, branch, commitHash) {
    writeLog(Public API update call for  + pluginName);
    const result = updatePlugin(pluginName, gitUrl, branch, commitHash);
    deployToExecutionDir(pluginName, path.join(getAppConfigDir(process.argv.join(' ').includes('claude') ? 'claude' : 'opencode'), "plugin"), result.changed);
}

export function earlyLaunch(configDir, plugins) {
    EARLY_LAUNCH_CONFIG_DIR = configDir;
    writeLog("Starting earlyLaunch updater sequence");
    
    if (!plugins || !Array.isArray(plugins)) {
        writeLog("No plugins provided to earlyLaunch", true);
        return;
    }

    for (const plugin of plugins) {
        if (!plugin.enabled) continue;
        if (plugin.autoUpdate === false) continue;
        if (!plugin.url) continue;

        writeLog(Processing earlyLaunch for  + plugin.name);
        try {
            const updateResult = updatePlugin(plugin.name, plugin.url, plugin.branch, null);
            deployToExecutionDir(plugin.name, path.join(configDir, "plugin"), updateResult.changed);
        } catch (e) {
            writeLog(Failed to process  + plugin.name + :  + e.message, true);
        }
    }
}

pluginUpdaterEntry(null);
