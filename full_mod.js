const inquirer = require('inquirer');
const ora = require('ora');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const yml = require('yaml');
const fastjsonpatch = require('fast-json-patch');
const { existsSync } = require('fs');
const admzip = require('adm-zip');
const rimraf = require('rimraf');

let syskey = [];
let gpath = "";
let steamkey = "";

async function readGameFileSteam(file, encoding) {
    let data = await fs.readFile(path.join(gpath, "www", file));

    let iv = data.slice(0, 16);
    data = data.slice(16);

    let decipher = crypto.createDecipheriv("aes-256-ctr", steamkey, iv);
    let result = Buffer.concat([decipher.update(data), decipher.final()]);

    if (encoding) { return result.toString(encoding); } else { return result; }
}

async function readGameFileRPGM(file) {
    file = file.replace(".png", ".rpgmvp");
    file = file.replace(".ogg", ".rpgmvo");
    if (syskey.length === 0) {
        let system = await readGameFileSteam("data/System.KEL", "utf-8");
        system = JSON.parse(system);
        let key = system.encryptionKey;

        while (key.length >= 2) {
            syskey.push(parseInt(key.substring(0, 2), 16));
            key = key.substring(2, key.length);
        }
    }

    let data = await fs.readFile(path.join(gpath, "www", file));
    data = data.slice(16);
    let l = syskey.length;
    for (let i = 0; i < 16; i++) {
        data[i] = data[i] ^ syskey[i % l];
    }

    return data;
}

function hash(data) {
    return crypto.createHash("sha256").update(data).digest("base64");
}

async function listDir(bpath, base) {
    let results = [];
    const internalListDir = async (dir, base) => {
        let files = await fs.readdir(dir);
        for (let file of files) {
            let details = await fs.stat(path.join(dir, file));
            if (details.isDirectory()) {
                await internalListDir(path.join(dir, file), path.join(base, file));
            } else {
                results.push(path.join(base, file));
            }
        }
    }

    await internalListDir(bpath, base);

    return results;
}

async function listDirDirs(bpath, base) {
    let results = [];
    const internalListDir = async (dir, base) => {
        let files = await fs.readdir(dir);
        for (let file of files) {
            let details = await fs.stat(path.join(dir, file));
            if (details.isDirectory()) {
                await internalListDir(path.join(dir, file), path.join(base, file));
                results.push(path.join(base, file));
            }
        }
    }

    await internalListDir(bpath, base);

    return results;
}

module.exports = async function(key, _gpath) {
    console.time("processing time");
    gpath = _gpath;
    steamkey = key;

    let answers = await inquirer.prompt([
        {type:"input", name:"modfolder", message:"Location of your www_playtest folder"},
        {type:"input", name:"modid", message:"What id should your mod have? (Zip name, ID in json)"},
        {type:"input", name:"modname", message:"Mod name"},
        {type:"input", name:"modversion", message:"Mod version"},
        {type:"input", name:"moddescription", message:"Mod description"},
        {type:"checkbox", name:"options", message:"Data Inclusion Options", choices: [
                {name: "Include RPG Maker Data?", value:"rpgdata", checked:true},
                {name: "Include RPG Maker Plugins?", value:"rpgplugins", checked:true},
                {name: "Include Tiled Maps?", value:"tiledmaps", checked:true},
                {name: "Include Languages?", value:"languages", checked:true},
                {name: "Include /img", value:"img", checked:true},
                {name: "Include /audio", value:"audio", checked:true},
                {name: "Include /movies", value:"movies", checked:true},
                {name: "Include /fonts", value:"fonts", checked:true},
                {name: "Include /icon", value:"icon", checked:true},
            ], loop: false, pageSize: 10
        },
        {type:"confirm", name:"delta", message:"Use deltas (if possible)?", default: true},
        {type:"confirm", name:"zip", message:"Zip mod up after building?", default: true}
    ]);

    let spinner = ora("Starting job").start();
    let jid = `TEMP_Job-${Math.floor(Math.random() * 10000).toString(36)}_${Math.floor(Math.random() * 10000).toString(36)}-${Math.floor(Math.random() * 10000).toString(36)}_${Math.floor(Math.random() * 10000).toString(36)}`;

    spinner.text = "Making job base folder";

    await fs.mkdir(path.join(process.cwd(), jid));
    await fs.mkdir(path.join(process.cwd(), jid, answers.modid));

    spinner.text = "Extracting system encryption key";
    await readGameFileRPGM("img/atlases/battleATLAS.png");

    let totalAssets = [];

    if (answers.options.includes("img")) {
        spinner.text = "Inspecting img";
        let game = (await listDir(path.join(gpath, "www/img"), "img")).map(a=>a.replace(".rpgmvp",".png"));
        let mod = await listDir(path.join(answers.modfolder, "img"), "img");

        let done = 0;
        for (let file of game) {
            done++;
            spinner.text = `Inspecting img ${done} / ${game.length} | ${mod.length} files destined for inclusion`;

            if (mod.includes(file)) {
                let modfile = await fs.readFile(path.join(answers.modfolder, file));
                let gameFile = (file.endsWith(".png") && file !== "img/system/Loading.png" && file !== "img/system/Window.png" && file !== "img\\system\\Loading.png" && file !== "img\\system\\Window.png") ? await readGameFileRPGM(file) : await fs.readFile(path.join(gpath, "www", file));

                if (hash(modfile) === hash(gameFile)) {
                    mod = mod.filter(a => a !== file);
                }
            }
        }

        spinner.stop();
        if (mod.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what files you want to include",
                    name: "included",
                    choices: mod.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            mod = selected.included;
        }
        for (let a of mod) { totalAssets.push(a); }
        spinner.start();
    }

    if (answers.options.includes("audio")) {
        spinner.text = "Inspecting audio";
        let game = (await listDir(path.join(gpath, "www/audio"), "audio")).map(a=>a.replace(".rpgmvo",".ogg"));
        let mod = await listDir(path.join(answers.modfolder, "audio"), "audio");

        let done = 0;
        for (let file of game) {
            done++;
            spinner.text = `Inspecting audio ${done} / ${game.length} | ${mod.length} files destined for inclusion`;

            if (mod.includes(file)) {
                let modfile = await fs.readFile(path.join(answers.modfolder, file));
                let gameFile = (file.endsWith(".ogg")) ? await readGameFileRPGM(file) : await fs.readFile(path.join(gpath, "www", file));

                if (hash(modfile) === hash(gameFile)) {
                    mod = mod.filter(a => a !== file);
                }
            }
        }

        spinner.stop();
        if (mod.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what files you want to include",
                    name: "included",
                    choices: mod.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            mod = selected.included;
        }
        for (let a of mod) { totalAssets.push(a); }
        spinner.start();
    }

    if (answers.options.includes("movies")) {
        spinner.text = "Inspecting movies";
        let game = (await listDir(path.join(gpath, "www/movies"), "movies"))
        let mod = await listDir(path.join(answers.modfolder, "movies"), "movies");

        let done = 0;
        for (let file of game) {
            done++;
            spinner.text = `Inspecting movies ${done} / ${game.length} | ${mod.length} files destined for inclusion`;

            if (mod.includes(file)) {
                let modfile = await fs.readFile(path.join(answers.modfolder, file));
                let gameFile = await fs.readFile(path.join(gpath, "www", file));

                if (hash(modfile) === hash(gameFile)) {
                    mod = mod.filter(a => a !== file);
                }
            }
        }
        spinner.stop();
        if (mod.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what files you want to include",
                    name: "included",
                    choices: mod.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            mod = selected.included;
        }
        for (let a of mod) { totalAssets.push(a); }
        spinner.start();
    }

    if (answers.options.includes("fonts")) {
        spinner.text = "Inspecting fonts";
        let game = (await listDir(path.join(gpath, "www/fonts"), "fonts"))
        let mod = await listDir(path.join(answers.modfolder, "fonts"), "fonts");

        let done = 0;
        for (let file of game) {
            done++;
            spinner.text = `Inspecting fonts ${done} / ${game.length} | ${mod.length} files destined for inclusion`;

            if (mod.includes(file)) {
                let modfile = await fs.readFile(path.join(answers.modfolder, file));
                let gameFile = await fs.readFile(path.join(gpath, "www", file));

                if (hash(modfile) === hash(gameFile)) {
                    mod = mod.filter(a => a !== file);
                }
            }
        }
        spinner.stop();
        if (mod.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what files you want to include",
                    name: "included",
                    choices: mod.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            mod = selected.included;
        }
        for (let a of mod) { totalAssets.push(a); }
        spinner.start();
    }

    if (answers.options.includes("icon")) {
        spinner.text = "Inspecting icon";
        let game = (await listDir(path.join(gpath, "www/icon"), "icon"))
        let mod = await listDir(path.join(answers.modfolder, "icon"), "icon");

        let done = 0;
        for (let file of game) {
            done++;
            spinner.text = `Inspecting icon ${done} / ${game.length} | ${mod.length} files destined for inclusion`;

            if (mod.includes(file)) {
                let modfile = await fs.readFile(path.join(answers.modfolder, file));
                let gameFile = await fs.readFile(path.join(gpath, "www", file));

                if (hash(modfile) === hash(gameFile)) {
                    mod = mod.filter(a => a !== file);
                }
            }
        }
        spinner.stop();
        if (mod.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what files you want to include",
                    name: "included",
                    choices: mod.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            mod = selected.included;
        }
        for (let a of mod) { totalAssets.push(a); }
        spinner.start();
    }

    spinner.text = "Including asset files...";
    let done = 0;
    for (let file of totalAssets) {
        done++;
        spinner.text = `Including asset files... ${done} / ${totalAssets.length}`;
        let dir = path.parse(file).dir;
        await fs.mkdir(path.join(process.cwd(), jid, answers.modid, dir), {recursive: true});
        await fs.writeFile(path.join(process.cwd(), jid, answers.modid, file), await fs.readFile(path.join(answers.modfolder, file)));
    }

    spinner.text = "Please wait...";

    if (answers.options.includes("languages")) {
        spinner.text = "Inspecting languages...";

        let gameFiles = (await fs.readdir(path.join(gpath, "www/languages/en")))
            .filter(a => !a.includes("donottouch.xls"))
            .map(a => a.replace(".HERO",".yaml"));
        let modFiles = (await fs.readdir(path.join(answers.modfolder, "languages/en")))
            .filter(a => !a.includes("donottouch.xls"));

        let newFiles = modFiles.filter(a => !gameFiles.includes(a));
        let changedFiles = [];

        let done = 0;
        for (let a of gameFiles) {
            done++;
            spinner.text = `Inspecting languages... ${done} / ${gameFiles.length} | ${newFiles.length} new, ${changedFiles.length} changed`;

            if (existsSync(path.join(answers.modfolder, "languages/en", a))) {
                let gameFile = await readGameFileSteam(path.join("languages/en", a.replace(".yaml", ".HERO")), "utf-8");
                let modFile = await fs.readFile(path.join(answers.modfolder, "languages/en", a), "utf-8");

                if (hash(gameFile) !== hash(modFile)) {
                    if (answers.delta)
                        changedFiles.push(a);
                    else
                        newFiles.push(a);
                }
            }
        }

        spinner.stop();
        if (changedFiles.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what language files you want included in delta patch",
                    name: "included",
                    choices: changedFiles.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            changedFiles = selected.included;
        }
        if (newFiles.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what language files you want included in full",
                    name: "included",
                    choices: newFiles.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            newFiles = selected.included;
        }

        spinner.start();
        spinner.text = "Including languages";
        if (newFiles.length > 0) await fs.mkdir(path.join(process.cwd(), jid, answers.modid, "text"));
        if (changedFiles.length > 0) await fs.mkdir(path.join(process.cwd(), jid, answers.modid, "text_delta"));

        for (let a of newFiles) {
            await fs.writeFile(path.join(process.cwd(), jid, answers.modid, "text", a.replace(".yaml", ".yml")), await fs.readFile(path.join(answers.modfolder, "languages/en", a)));
        }

        for (let a of changedFiles) {
            let gameFile = await readGameFileSteam(path.join("languages/en", a.replace(".yaml", ".HERO")), "utf-8");
            let modFile = await fs.readFile(path.join(answers.modfolder, "languages/en", a), "utf-8");

            gameFile = yml.parse(gameFile);
            modFile = yml.parse(modFile);

            let delta = fastjsonpatch.compare(gameFile, modFile);

            await fs.writeFile(path.join(process.cwd(), jid, answers.modid, "text_delta", a.replace(".yaml", ".ymld")), JSON.stringify(delta, null, 2));
        }
    }

    if (answers.options.includes("tiledmaps")) {
        spinner.text = "Inspecting tiled maps...";

        let gameFiles = (await fs.readdir(path.join(gpath, "www/maps")))
            .map(a => a.replace(".AUBREY",".json"));
        let modFiles = (await fs.readdir(path.join(answers.modfolder, "maps")))

        let newFiles = modFiles.filter(a => !gameFiles.includes(a));
        let changedFiles = [];

        let done = 0;
        for (let a of gameFiles) {
            done++;
            spinner.text = `Inspecting maps... ${done} / ${gameFiles.length} | ${newFiles.length} new, ${changedFiles.length} changed`;

            if (existsSync(path.join(answers.modfolder, "maps", a))) {
                let gameFile = await readGameFileSteam(path.join("maps", a.replace(".json", ".AUBREY")), "utf-8");
                let modFile = await fs.readFile(path.join(answers.modfolder, "maps", a), "utf-8");

                if (hash(gameFile) !== hash(modFile)) {
                    if (answers.delta)
                        changedFiles.push(a);
                    else
                        newFiles.push(a);

                }
            }
        }

        spinner.stop();
        if (changedFiles.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what tiled map files you want included in delta patch",
                    name: "included",
                    choices: changedFiles.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            changedFiles = selected.included;
        }
        if (newFiles.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what tiled map files you want included in full",
                    name: "included",
                    choices: newFiles.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            newFiles = selected.included;
        }

        spinner.start();
        spinner.text = "Including tiled maps";
        if (newFiles.length > 0) await fs.mkdir(path.join(process.cwd(), jid, answers.modid, "maps"));
        if (changedFiles.length > 0) await fs.mkdir(path.join(process.cwd(), jid, answers.modid, "maps_delta"));

        for (let a of newFiles) {
            await fs.writeFile(path.join(process.cwd(), jid, answers.modid, "maps", a), await fs.readFile(path.join(answers.modfolder, "maps", a)));
        }

        for (let a of changedFiles) {
            let gameFile = await readGameFileSteam(path.join("maps", a.replace(".json", ".AUBREY")), "utf-8");
            let modFile = await fs.readFile(path.join(answers.modfolder, "maps", a), "utf-8");

            let delta = fastjsonpatch.compare(gameFile, modFile);

            await fs.writeFile(path.join(process.cwd(), jid, answers.modid, "maps_delta", a + "d"), JSON.stringify(delta, null, 2));
        }
    }

    if (answers.options.includes("rpgplugins")) {
        spinner.text = "Inspecting plugins...";

        eval(await fs.readFile(path.join(answers.modfolder, "js", "plugins.js"), "utf-8"));
        let registered_mod_plugins = [];
        for (let a of $plugins) {
            if (a.status) {
                registered_mod_plugins.push(a.name);
            }
        }

        eval(await fs.readFile(path.join(gpath, "www/js", "plugins.js"), "utf-8"));
        let registered_game_plugins = [];
        for (let a of $plugins) {
            if (a.status) {
                registered_game_plugins.push(a.name);
            }
        }

        let newFiles = [];
        for (let a of registered_mod_plugins) {
            if ((["YEP_TestPlayAssist", "YEP_Debugger"]).includes(a)) continue;
            if (!registered_game_plugins.includes(a)) {
                newFiles.push(a);
            } else {
                let gameFileHash = hash(await readGameFileSteam("js/plugins/" + a + ".OMORI", "utf-8"));
                let modFileHash = hash(await fs.readFile(path.join(answers.modfolder, "js/plugins", a + ".js"), "utf-8"));

                if (gameFileHash !== modFileHash) {
                    newFiles.push(a);
                }
            }
        }

        spinner.stop();

        if (newFiles.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what plugins you want included",
                    name: "included",
                    choices: newFiles.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            newFiles = selected.included;
        }

        spinner.start();
        spinner.text = "Including plugins...";

        if (newFiles.length > 0) await fs.mkdir(path.join(process.cwd(), jid, answers.modid, "plugins"));

        for (let a of newFiles) {
            await fs.writeFile(
                path.join(process.cwd(), jid, answers.modid, "plugins", a + ".js"),
                await fs.readFile(
                    path.join(answers.modfolder, "js/plugins/", a + ".js")
                )
            );
        }
    }

    if (answers.options.includes("rpgdata")) {
        spinner.text = "Inspecting yaml data";

        {
            // Data_Pluto first, it's weird, thank you omocat
            let gameFiles = ["Atlas.yaml", "Notes.yaml", "Quests.yaml"];
            let changed = [];
            for (let i of gameFiles) {
                if (existsSync(path.join(answers.modfolder, "data", i))) {
                    let gameFile = await readGameFileSteam("data/" +  i.replace(".yaml", ".PLUTO"), "utf-8");
                    let modFile = await fs.readFile(path.join(answers.modfolder, "data", i), "utf-8");

                    if (hash(gameFile) !== hash(modFile)) {
                        changed.push(i);
                    }
                }
            }

            if (changed.length > 0) {
                spinner.stop();
                let selected = await inquirer.prompt([
                    {
                        type: "checkbox",
                        message: "Select what yaml data you want to include (NOTE: THINK CAREFULLY HERE, THIS DATA IS NOT DELTA-PATCHABLE AS OF GOMORI 2.2.0!)",
                        name: "included",
                        choices: changed.map(a => {
                            return {name: a, value: a, checked: true}
                        }),
                        loop: false,
                        pageSize: 15
                    }
                ]);
                changed = selected.included;

                spinner.start();
                if (changed.length > 0) {
                    spinner.text = "Including yaml data";
                    await fs.mkdir(path.join(process.cwd(), jid, answers.modid, "data_pluto"));
                    for (let a of changed) {
                        let modFile = await fs.readFile(path.join(answers.modfolder, "data", a), "utf-8");

                        await fs.writeFile(path.join(process.cwd(), jid, answers.modid, "data_pluto", a), modFile);
                    }
                }
            }
        }

        spinner.text = "Inspecting JSON data";
        let gameFiles = (await fs.readdir(path.join(gpath, "www/data"))).filter(a => !a.includes(".PLUTO")).map(a => a.replace(".KEL", ".json"));
        let modFiles = (await fs.readdir(path.join(answers.modfolder, "data"))).filter(a => !a.includes(".yaml"));

        let changedFiles = [];
        let newFiles = modFiles.filter(a => !gameFiles.includes(a));

        let done = 0;
        for (let a of gameFiles) {
            done++;
            spinner.text = `Inspecting game data... ${done} / ${gameFiles.length} | ${newFiles.length} new, ${changedFiles.length} changed`;

            if (existsSync(path.join(answers.modfolder, "data", a))) {
                let gameFile = JSON.parse(await readGameFileSteam(path.join("data", a.replace(".json", ".KEL")), "utf-8"));
                let modFile = JSON.parse(await fs.readFile(path.join(answers.modfolder, "data", a), "utf-8"));
                gameFile = require('./data_tree_sanitizer')(a, gameFile);
                modFile = require('./data_tree_sanitizer')(a, modFile);

                if (hash(JSON.stringify(gameFile)) !== hash(JSON.stringify(modFile))) {
                    if (answers.delta)
                        changedFiles.push(a);
                    else
                        newFiles.push(a);
                }
            }
        }

        spinner.stop();
        if (changedFiles.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what data files you want included in delta patch",
                    name: "included",
                    choices: changedFiles.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            changedFiles = selected.included;
        }
        if (newFiles.length > 0) {
            let selected = await inquirer.prompt([
                {
                    type: "checkbox",
                    message: "Select what data files you want included in full",
                    name: "included",
                    choices: newFiles.map(a => {
                        return {name: a, value: a, checked: true}
                    }),
                    loop: false,
                    pageSize: 15
                }
            ]);
            newFiles = selected.included;
        }

        spinner.start();
        spinner.text = "Including data";
        if (newFiles.length > 0) await fs.mkdir(path.join(process.cwd(), jid, answers.modid, "data"));
        if (changedFiles.length > 0) await fs.mkdir(path.join(process.cwd(), jid, answers.modid, "data_delta"));

        for (let a of newFiles) {
            await fs.writeFile(path.join(process.cwd(), jid, answers.modid, "data", a), await fs.readFile(path.join(answers.modfolder, "data", a)));
        }

        for (let a of changedFiles) {
            let gameFile = JSON.parse(await readGameFileSteam(path.join("data", a.replace(".json", ".KEL")), "utf-8"));
            let modFile = JSON.parse(await fs.readFile(path.join(answers.modfolder, "data", a), "utf-8"));
            gameFile = require('./data_tree_sanitizer')(a, gameFile);
            modFile = require('./data_tree_sanitizer')(a, modFile);

            let delta = fastjsonpatch.compare(gameFile, modFile);
            await fs.writeFile(path.join(process.cwd(), jid, answers.modid, "data_delta", a + "d"), JSON.stringify(delta, null, 2));
        }
    }

    spinner.text = "Building mod.json";
    let modJson = {
        id: answers.modid,
        name: answers.modname,
        description: answers.description,
        version: answers.modversion,
        files: {
            plugins: [],
            text: [],
            data: [],
            data_pluto: [],
            maps: [],
            assets: [],
            exec: [],
            plugins_delta: [],
            text_delta: [],
            maps_delta: [],
            data_delta: []
        }
    };

    if (existsSync(path.join(process.cwd(), jid, answers.modid, "plugins")))    modJson.files.plugins.push("plugins/");
    if (existsSync(path.join(process.cwd(), jid, answers.modid, "text")))       modJson.files.text.push("text/");
    if (existsSync(path.join(process.cwd(), jid, answers.modid, "data")))       modJson.files.data.push("data/");
    if (existsSync(path.join(process.cwd(), jid, answers.modid, "data_pluto"))) modJson.files.data_pluto.push("data_pluto/");
    if (existsSync(path.join(process.cwd(), jid, answers.modid, "maps")))       modJson.files.maps.push("maps/");
    if (existsSync(path.join(process.cwd(), jid, answers.modid, "text_delta"))) modJson.files.text_delta.push("text_delta/");
    if (existsSync(path.join(process.cwd(), jid, answers.modid, "data_delta"))) modJson.files.data_delta.push("data_delta/");
    if (existsSync(path.join(process.cwd(), jid, answers.modid, "maps_delta"))) modJson.files.maps_delta.push("maps_delta/");

    // assets (basic)
    if (existsSync(path.join(process.cwd(), jid, answers.modid, "fonts")))       modJson.files.assets.push("fonts/");
    if (existsSync(path.join(process.cwd(), jid, answers.modid, "movies")))      modJson.files.assets.push("movies/");

    // assets (advanced)
    if (existsSync(path.join(process.cwd(), jid, answers.modid, "img"))) {
        let imgDirs = await listDirDirs(path.join(process.cwd(), jid, answers.modid, "img"), "img");
        imgDirs.map(a => modJson.files.assets.push(a.replace("\\", "/") + "/"));
    }

    if (existsSync(path.join(process.cwd(), jid, answers.modid, "audio"))) {
        let audioDirs = await listDirDirs(path.join(process.cwd(), jid, answers.modid, "audio"), "audio");
        audioDirs.map(a => modJson.files.assets.push(a.replace("\\", "/") + "/"));
    }

    await fs.writeFile(path.join(process.cwd(), jid, answers.modid, "mod.json"), JSON.stringify(modJson, null, 2));

    spinner.text = "Almost there";

    if (answers.zip) {
        spinner.text = "Writing zip";
        let modFiles = await listDir(path.join(process.cwd(), jid, answers.modid), answers.modid);
        let zip = new admzip();
        let done = 0;
        for (let a of modFiles) {
            done++;
            spinner.text = `Writing zip ${done} / ${modFiles.length}`;
            zip.addFile(a, await fs.readFile(path.join(process.cwd(), jid, a)));
        }

        zip.writeZip(path.join(process.cwd(), answers.modid + ".zip"));
        rimraf.sync(jid);

        spinner.succeed("Mod written to " + answers.modid + ".zip");
    } else {
        spinner.succeed("Unpacked mod can be found in " + jid + "/");
    }

    console.log("Thank you for using GMKR ( GomoriMaKeR ) by Rph");
    console.timeEnd("processing time");
}
