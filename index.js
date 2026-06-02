module.exports = {
  name: "plugin-updater",

  rebuild: function(pluginItem) {
    if (global.OpenCodeAPI && global.OpenCodeAPI.log) {
      global.OpenCodeAPI.log("Rebuilding " + pluginItem.name);
    }
    return this._update(pluginItem);
  },

  downgrade: function(pluginItem, commitHash) {
    return this._update(pluginItem, commitHash);
  },

  disable: function(pluginItem) {},

  uninstall: function(pluginItem) {
    if (global.OpenCodeAPI && global.OpenCodeAPI.removePluginFiles) {
      global.OpenCodeAPI.removePluginFiles(pluginItem.name);
    }
  },

  _update: function(pluginItem, commitHash) {
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');

    if (!global.OpenCodeAPI) return "No Launcher API available";

    const reposDir = global.OpenCodeAPI.getReposDir();
    var folderName = pluginItem.name.replace(/[^a-zA-Z0-9-]/g, '-');
    var dir = path.join(reposDir, "intisy", folderName);

    if (!fs.existsSync(dir)) {
      var parentDir = path.dirname(dir);
      if (!fs.existsSync(parentDir)) try { fs.mkdirSync(parentDir, { recursive: true }); } catch {}
      try {
        var cloneCmd = "git clone --recurse-submodules " + pluginItem.url + (pluginItem.branch ? " --branch " + pluginItem.branch : "") + " " + folderName;
        execSync(cloneCmd, { cwd: path.dirname(dir), timeout: 60000, stdio: "ignore" });
      } catch (e) { return "Clone failed: " + (e.message || e); }
    } else {
      try {
        if (commitHash) {
          execSync("git fetch origin", { cwd: dir, timeout: 30000, stdio: "ignore" });
          execSync("git checkout " + commitHash, { cwd: dir, timeout: 10000, stdio: "ignore" });
        } else if (pluginItem.branch) {
          execSync("git fetch origin", { cwd: dir, timeout: 30000, stdio: "ignore" });
          execSync("git checkout " + pluginItem.branch, { cwd: dir, timeout: 10000, stdio: "ignore" });
          execSync("git pull --ff-only origin " + pluginItem.branch, { cwd: dir, timeout: 30000, stdio: "ignore" });
        } else {
          execSync("git checkout main || git checkout master", { cwd: dir, timeout: 10000, stdio: "ignore" });
          execSync("git pull --ff-only", { cwd: dir, timeout: 30000, stdio: "ignore" });
        }
        execSync("git submodule update --init --recursive", { cwd: dir, timeout: 30000, stdio: "ignore" });
      } catch {}
    }

    if (pluginItem.install) {
      try { execSync(pluginItem.install.join(" "), { cwd: dir, timeout: 120000, stdio: "ignore" }); }
      catch (e) { return "Install failed"; }
    }
    if (pluginItem.postInstall) {
      try { execSync(pluginItem.postInstall.join(" "), { cwd: dir, timeout: 120000, stdio: "ignore" }); }
      catch (e) { return "Post-install failed"; }
    }
    if (pluginItem.build) {
      try { execSync(pluginItem.build.join(" "), { cwd: dir, timeout: 120000, stdio: "ignore" }); }
      catch (e) { return "Build failed"; }
    }
    if (pluginItem.bundle) {
      try { execSync(pluginItem.bundle.join(" "), { cwd: dir, timeout: 120000, stdio: "ignore" }); }
      catch (e) { return "Bundle failed"; }
    }

    var outputPath = path.join(dir, pluginItem.output || pluginItem.pluginFile || '');
    global.OpenCodeAPI.deployPlugin(pluginItem.name, outputPath);

    return "Success";
  },

  registerTests: function(testApi) {
    testApi.addTest("updater", "Verify tui.js Sync", () => {
      const fs = require('fs');
      const path = require('path');
      const crypto = require('crypto');
      const HOME = require('os').homedir();

      const fileHash = (p) => { try { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 12); } catch { return null; } };

      const CORE_HUB = path.join(HOME, ".config", "github", "repos", "intisy", "core-hub", "tui.js");
      const CLAUDE_HUB = path.join(HOME, ".config", "claude", "repos", "intisy", "claude-hub", "core", "tui.js");
      const OC_HUB = path.join(HOME, ".config", "opencode", "repos", "intisy", "opencode-hub", "core", "tui.js");

      const hA = fileHash(CORE_HUB);
      const hB = fileHash(CLAUDE_HUB);
      const hC = fileHash(OC_HUB);

      if (!hA) return { passed: false, message: "core-hub/tui.js missing" };
      if (hB && hA !== hB) return { passed: false, message: "claude-hub/core/tui.js out of sync" };
      if (hC && hA !== hC) return { passed: false, message: "opencode-hub/core/tui.js out of sync" };
      return { passed: true, message: "tui.js in sync" };
    });
  }
};
