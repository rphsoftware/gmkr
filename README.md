# gmkr
Gomori Maker - A tool for converting Playtestmaker mods into valid GOMORI mod zips

# Usage:
- Make sure you have OMORI maked as "installed" on steam
- Prepare a copy of the game where the version matches your playtest version (If you ran playtest maker against 1.0.7, obtain a copy of 1.0.7 of the game)
  - To obtain the copy do the following:
    - Back up your saves and mods
    - Select the version you want from steam betas
    - Let steam download the taget version
    - Delete the WHOLE `www` folder from the game
    - Verify integrity using steam
- Run the program
- Paste a path to the OMORI folder (not www) in the first step
- Follow on-screen prompts

# Compilation:
- You will need:
  - Node.js
- In a powershell window first run `npm install` and then `npx pkg .`, the windows binary will be located inside the `dist` folder

# Contact
If you have any doubts, please contact me on Discord (`Rph#9999`), or open a github issue.
