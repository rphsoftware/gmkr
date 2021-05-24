const inquirer = require('inquirer');
const crypto = require("crypto")
const fs = require('fs').promises;
const path = require('path');
const ora = require('ora');
const yml = require('yaml');
const fastjsonpatch = require('fast-json-patch');
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

async function tryFile(f) {
    try {
        return await fs.readFile(f);
    } catch(e) {
        return await fs.readFile(f.replace(".yml", ".yaml"));
    }
}

module.exports = async function(key, gpath) {
    let p = (await inquirer.prompt([
            {type:"input", name:"gamepath", message:"Language folder path"}
        ])).gamepath;

    let tgt = (await inquirer.prompt([
        {type:"input", name:"gamepath", message:"Target for deltas"}
    ])).gamepath;

    let spinner = ora("Working").start();
    let files = (await fs.readdir(p)).map( a => a.replace(".yaml", ".yml"));
    let gfiles = await fs.readdir(path.join(gpath, "www","languages","en"));
    gfiles = gfiles.map(a => a.replace(".HERO", ".yml"));

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
        if (a === "donottouch.xlsx") continue;
        let gameFile = await fs.readFile(path.join(gpath, "www","languages","en", a.replace(".yml", ".HERO")));
        let gameFileData = applySteamLibrary(gameFile, key).toString("utf-8")
        gameFile = yml.parse( applySteamLibrary(gameFile, key).toString("utf-8") );

        let sfile = (await tryFile(path.join(p, a))).toString("utf-8");
        let sfileData = sfile;

        if (hash(gameFileData) === hash(sfileData)) {
            continue
        }

        sfile = yml.parse( sfile );

        let delta = fastjsonpatch.compare(gameFile, sfile);

        await fs.writeFile(path.join(tgt, a + "d"), JSON.stringify(delta, null, 2));
    }

    spinner.succeed("Done");

    if (unknownFiles.length > 0) {
        console.log('The following files were ignored (cant delta against non-existent base game file: )');
        console.log(unknownFiles.join(", "));
    }
}