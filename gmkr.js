const fs = require('fs').promises;
const crypto = require('crypto');
const path = require('path');
const inquirer = require('inquirer');
const { existsSync } =require('fs');
const KEY_HASH = "sdUNJoYkj8STtxzUkMuIrHXnHK/yNv20q5+nijYxnhE=" // note to omocat's legal team: this isn't the key
function hash(data) {
    return crypto.createHash("sha256").update(data).digest("base64");
}
(async function run() {
    console.log("Obtaining encryption key...");

    let steamFolder = ({
        "linux": process.env.HOME + "/.local/share/Steam/",
        "darwin":process.env.HOME + "/Library/Application Support/Steam/",
        "win32":"C:\\Program Files (x86)\\Steam\\"
    });

    let appInfo = path.join(steamFolder[process.platform], "appcache", "appinfo.vdf");
    let data = await fs.readFile(appInfo, "utf-8");
    let keyRe = /--([0-9a-f]{32})/g;

    let u = [...data.matchAll(keyRe)];
    let key;
    for (let k of u) {
        if (hash(k[1]) === KEY_HASH) {
            key = k[1];
            break;
        }
    }
    if (!key) {
        console.log("buy the game on steam fuckass (or if you already bought it, install it)"); //thanks saike
        process.exit(-69);
    }

    let p;
    let pm;
    if (!process.env.GAME_PATH)
        p = (await inquirer.prompt([
            {type:"input", name:"gamepath", message:"Give the game path"}
        ])).gamepath;
    else
        p = process.env.GAME_PATH;

    if (
        !existsSync(path.join(p, "www")) ||
        !existsSync(path.join(p, "www", "img")) ||
        !existsSync(path.join(p, "www", "js")) ||
        !existsSync(path.join(p, "www", "js", "rpg_core.js"))
    ) {
        console.log("This isn't a valid omori install.");
        process.exit(-69);
    }

    if (
        existsSync(path.join(p, "www", "gomori"))
    ) {
        console.log("You NEED to run this tool against a COMPLETELY STOCK copy of the game. DELETE the game, and REINSTALL CLEANLY the version you want to create the mod against. Alternatively, point this tool at a backed up copy.");
        process.exit(-69);
    }

    let {m} = await inquirer.prompt([
        {
            type:"list", choices: [
                "Data deltas",
                "Language deltas",
                "Tiled Map deltas",
                "Full mod generation"
            ], name: "m", message:"Select mode of operation"
        }
    ]);
    try {
        if (m === "Language deltas") {
            await require('./lang_deltas')(key, p);
        }
        if (m === "Data deltas") {
            await require('./data_deltas')(key, p);
        }
        if (m === "Tiled Map deltas") {
            await require('./tiled_delta')(key, p);
        }
        if (m === "Full mod generation") {
            await require('./full_mod')(key, p);
        }
    } catch(e) {
        console.error("An error occured at runtime: " + e);
    } finally {
        if (process.platform === "win32") {
            require('child_process').execSync("pause");
        }
    }
})();