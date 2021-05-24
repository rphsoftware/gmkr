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
        {type:"input", name:"gamepath", message:"Tiled map folder path"}
    ])).gamepath;

    let tgt = (await inquirer.prompt([
        {type:"input", name:"gamepath", message:"Target for deltas"}
    ])).gamepath;

    let spinner = ora("Working").start();
    let files = await fs.readdir(p);
    let gfiles = await fs.readdir(path.join(gpath, "www","maps"));
    gfiles = gfiles.map(a => a.replace(".AUBREY", ".json"));

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

        let gameFile = applySteamLibrary( await fs.readFile(path.join(gpath, "www/maps", a.replace(".json", ".AUBREY"))), key).toString("utf-8");
        let modFile = await fs.readFile(path.join(p, a), "utf-8");

        let gfTree = JSON.parse(gameFile);
        let mfTree = JSON.parse(modFile);

        if (hash(JSON.stringify(gfTree)) === hash(JSON.stringify(mfTree))) continue;


        let diff = fastjsonpatch.compare(gfTree, mfTree);

        await fs.writeFile(path.join(tgt, a.replace("json", "jsond")), JSON.stringify(diff, null, 2));
    }

    spinner.succeed("Done");
    if (unknownFiles.length > 0) {
        console.log('The following files were ignored (cant delta against non-existent base game file: )');
        console.log(unknownFiles.join(", "));
    }
}