const inquirer = require('inquirer');
const crypto = require("crypto")
const fs = require('fs').promises;
const path = require('path');
const ora = require('ora');
const yml = require('yaml');
const fastjsonpatch = require('fast-json-patch');
const sanitizer = require('./data_tree_sanitizer');
function hash(data) {
    return crypto.createHash("sha256").update(data).digest("base64");
}
const algorithm = "aes-256-ctr";
const applySteamLibrary = (plugins, steamkey) => {
    const i = plugins.slice(0,16);
    plugins = plugins.slice(16);
    const d = crypto.createDecipheriv(algorithm, steamkey, i);
    const r = Buffer.concat([d.update(plugins), d.final()]);
    return r;
}

module.exports = async function(key, gpath) {
    let p = (await inquirer.prompt([
        {type:"input", name:"gamepath", message:"Data folder path"}
    ])).gamepath;

    let tgt = (await inquirer.prompt([
        {type:"input", name:"gamepath", message:"Target for deltas"}
    ])).gamepath;

    let spinner = ora("Working").start();
    let files = await fs.readdir(p);
    let gfiles = await fs.readdir(path.join(gpath, "www","data"));
    gfiles = gfiles.map(a => a.replace(".KEL", ".json"));
    gfiles = gfiles.map(a => a.replace(".PLUTO", ".yaml"));

    let todoList = [];
    let unknownFiles = [];

    for (let f of files) {
        if (gfiles.includes(f)) todoList.push(f);
        else unknownFiles.push(f);
    }

    try { await fs.mkdir(tgt); } catch(e) {}

    let done = 0;
    let todo = todoList.length;

    for (let a of todoList) {
        done++;
        spinner.text = `${done} / ${todo}`;

        if (a.endsWith(".yaml")) { // yaml mode
            let gameFile = applySteamLibrary( await fs.readFile(path.join(gpath, "www/data", a.replace(".yaml", ".PLUTO"))), key).toString("utf-8");
            let modFile = await fs.readFile(path.join(p, a), "utf-8");

            if (hash(gameFile) === hash(modFile)) continue;

            let gfTree = yml.parse(gameFile);
            let mfTree = yml.parse(modFile);

            let diff = fastjsonpatch.compare(gfTree, mfTree);

            await fs.writeFile(path.join(tgt, a.replace("yaml", "ymld")), JSON.stringify(diff, null, 2));
        } else { // json mode
            let gameFile = applySteamLibrary( await fs.readFile(path.join(gpath, "www/data", a.replace(".json", ".KEL"))), key).toString("utf-8");
            let modFile = await fs.readFile(path.join(p, a), "utf-8");

            let gfTree = sanitizer(a, JSON.parse(gameFile));
            let mfTree = sanitizer(a, JSON.parse(modFile));

            if (hash(JSON.stringify(gfTree)) === hash(JSON.stringify(mfTree))) continue;


            let diff = fastjsonpatch.compare(gfTree, mfTree);

            await fs.writeFile(path.join(tgt, a.replace("json", "jsond")), JSON.stringify(diff, null, 2));
        }
    }

    spinner.succeed("Done");
    if (unknownFiles.length > 0) {
        console.log('The following files were ignored (cant delta against non-existent base game file: )');
        console.log(unknownFiles.join(", "));
    }
}