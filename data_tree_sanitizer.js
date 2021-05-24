module.exports = function(fileName, tree) {
    if (fileName === "MapInfos.json") {
        for (let a of tree) {
            if (a) {
                a.scrollX = 0;
                a.scrollY = 0;
                a.expanded = true;
            }
        }
    }

    if (fileName === "System.json") {
        tree.hasEncryptedAudio = true;
        tree.hasEncryptedImages = true;
        tree.versionId = 0;
        tree.editMapId = 0;
    }

    return tree;
}