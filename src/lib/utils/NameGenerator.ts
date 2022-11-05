/**
 * DarkestDungeon Save Editor is a tool for viewing and modifying DarkestDungeon game saves.
 * Copyright (C) 2022 Travis Lane (Tormak)
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>
 */
import fs from "fs";
import path from "path";

function readDirRecursive(dirPath:string, arrayOfFiles:string[] = []) {
    const files = fs.readdirSync(dirPath);
  
    files.forEach(function(file) {
        const newPath = path.join(dirPath, file);
        if (fs.statSync(newPath).isDirectory()) {
            arrayOfFiles = readDirRecursive(newPath, arrayOfFiles);
        } else {
            arrayOfFiles.push(newPath);
        }
    });
  
    return arrayOfFiles;
  }

interface Parser {
    parseFile(path:string, names:Set<string>): void;
}

export class NameGenerator {
    hardcodedNames = new Set<string>();
    parsers = new Map<string, Parser[]>();

    constructor() {
        // Info files (Heroes, Monsters)
		this.addParser(".info.darkest", {
            parseFile(fPath:string, names:Set<string>) {
				NameGenerator.addBaseName(fPath, names);
			}
        });

		// Upgrades
        this.addParser(".upgrades.json", {
			parseFile(fPath:string, names:Set<string>) {
                const buf = fs.readFileSync(fPath);
				NameGenerator.addBaseName(fPath, names);
				const ids = new Set<string>();
				NameGenerator.addSimpleJSONArrayEntryIDs(buf, "trees", "id", ids);
				for (const id of ids) {
					names.add(id);
					// For backer file, strip class name
					const splits = id.split("\\.");
					if (splits.length == 2) {
						names.add(splits[1]);
					}
				}
			}
		});

		// Camping skills
		// Camping skills do NOT have corresponding upgrade trees,
		// even though they appear in persist.upgrades.json
		// the actual saved hashed tree name is "soldierclass.skill", even though skills may be shared
		// (Though the backer file has the skills in pure form???)
        this.addParser(".camping_skills.json", {
			parseFile(fPath:string, names:Set<string>) {
                const buf = fs.readFileSync(fPath);
				const json = buf.toJSON();
		        const arrArray:any[] = json["skills"];
				if (arrArray != null) {
					for (let i = 0; i < arrArray.length; i++) {
						const id = arrArray[i]["id"];
						names.add(id);
						const classes = arrArray[i]["hero_classes"];
						if (classes != null) {
							for (const elem of classes) {
								names.add(elem + "." + id);
							}
						}
					}
				}
			}
		});

		// Dungeon types
        this.addParser(".dungeon.json", {
			parseFile(fPath:string, names:Set<string>) {
                NameGenerator.addBaseName(fPath, names);
			}
		});

		// Quest types
        this.addParser(".types.json", {
			parseFile(fPath:string, names:Set<string>) {
                const buf = fs.readFileSync(fPath);
                NameGenerator.addSimpleJSONArrayEntryIDs(buf, "types", "id", names);
				NameGenerator.addSimpleJSONArrayEntryIDs(buf, "goals", "id", names);
			}
		});

		// Quirks
        this.addParser("quirk_library.json", {
			parseFile(fPath:string, names:Set<string>) {
                const buf = fs.readFileSync(fPath);
                NameGenerator.addSimpleJSONArrayEntryIDs(buf, "quirks", "id", names);
			}
		});

		// Buildings and activities
        this.addParser(".building.json", {
			parseFile(fPath:string, names:Set<string>) {
                NameGenerator.addBaseName(fPath, names);
                const buf = fs.readFileSync(fPath);
				const json = buf.toJSON();
				const dataObject = json["data"];
				if (dataObject != null) {
					const activitiesArray = dataObject["activities"];
					if (activitiesArray != null) {
						for (const elem of activitiesArray) {
							names.add(elem["id"]);
						}
					}
				}
			}
		});

		// Town events 
        this.addParser(".events.json", {
			parseFile(fPath:string, names:Set<string>) {
                const buf = fs.readFileSync(fPath);
                NameGenerator.addBaseName(fPath, names);
                NameGenerator.addSimpleJSONArrayEntryIDs(buf, "events", "id", names)
			}
		});

        const invRegex = new RegExp("inventory_item:\\s?\\.type\\s?\"([a-z_]*)\"\\s*\\.id\\s*\"([a-z_]*)\".*");
        const inventoryParser:Parser = {
            parseFile(fPath:string, names:Set<string>) {
				// split lines
				const lines = fs.readFileSync(fPath, { encoding: 'utf-8' }).split("\\r?\\n");
				for (const str of lines) {
					const matches = str.match(invRegex);
					if (matches) {
						// 0 is the entire matched string
						for (let i = 1; i <= matches.length; i++) {
							const group = matches[i];
							if (group != "" && group) {
								names.add(group);
							}
						}
					}
				}
			}
        }

		// Inventory Items
        this.addParser(".inventory.items.darkest", inventoryParser);
        this.addParser(".inventory.system_configs.darkest", inventoryParser);

		// Town events 
        this.addParser(".trinkets.json", {
			parseFile(fPath:string, names:Set<string>) {
                const buf = fs.readFileSync(fPath);
                NameGenerator.addSimpleJSONArrayEntryIDs(buf, "entries", "id", names);
			}
		});

		// Curios
		// TODO: Some Quest curios aren't caught. Need to find where they're defined
        this.addParser("curio_props.csv", {
			parseFile(fPath:string, names:Set<string>) {
                // csv file -- just read the first column
				const lines = fs.readFileSync(fPath, { encoding: 'utf-8' }).split("\\r?\\n");
				for (const str of lines) {
					const propName = str.substring(0, str.indexOf(","));
					if (propName != "" && propName) {
						names.add(propName);
					}
				}
			}
		});

		// Obstacles 
        this.addParser("obstacle_definitions.json", {
			parseFile(fPath:string, names:Set<string>) {
                const buf = fs.readFileSync(fPath);
                NameGenerator.addSimpleJSONArrayEntryIDs(buf, "props", "name", names);
			}
		});

		// Obstacles 
        this.addParser("quest.plot_quests.json", {
			parseFile(fPath:string, names:Set<string>) {
                const buf = fs.readFileSync(fPath);
                NameGenerator.addSimpleJSONArrayEntryIDs(buf, "plot_quests", "id", names);
			}
		});

		// Tutorial event 
        this.addParser("", {
			parseFile(fPath:string, names:Set<string>) {
                const tutRegex = new RegExp(".*tutorial_popup\\.([a-z_]*)\\.png");
				const matches = fPath.match(tutRegex);
                if (matches) {
                    // 0 is the entire matched string
                    for (let i = 1; i <= matches.length; i++) {
                        const group = matches[i];
                        if (group != "" && group) {
                            names.add(group);
                        }
                    }
                }
			}
		});

        this.hardcodedNames.add("MONSTER_ENCOUNTERED");
		this.hardcodedNames.add("AMBUSHED");
		this.hardcodedNames.add("CURIO_INVESTIGATED");
		this.hardcodedNames.add("TRAIT_APPLIED");
		this.hardcodedNames.add("DEATHS_DOOR_APPLIED");
		this.hardcodedNames.add("ROOM_VISITED");
		this.hardcodedNames.add("BATTLE_COMPLETED");
		this.hardcodedNames.add("HALLWAY_STEP_COMPLETED");
		this.hardcodedNames.add("MONSTER_DEFEATED");
		this.hardcodedNames.add("UNDEFINED");
    }

    private addParser(ext:string, parser:Parser) {
        let parserList = this.parsers.get(ext);

        if (parserList == null) this.parsers.set(ext, parserList = []);
        if (!parserList.includes(parser)) parserList.push(parser);
    }

    static addBaseName(fPath:string, names:Set<string>) {
		let fileName = path.basename(fPath);
		if (fileName.indexOf(".") > 0) {
			fileName = fileName.substring(0, fileName.indexOf("."));
		}
		names.add(fileName);
	}

    static addSimpleJSONArrayEntryIDs(data:Buffer, arrayName:string, idString:string, set:Set<string>) {
		const json = data.toJSON();
		const arrArray:any[] = json[arrayName];
		if (arrArray != null) {
			for (let i = 0; i < arrArray.length; i++) {
				const id = arrArray[i][idString];
				set.add(id);
			}
		}
	}

    findNames(gameDirs:string[]):Set<string> {
        const names = new Set<string>();

        for (let i = 0; i < gameDirs.length; i++) {
            const dirPath = gameDirs[i];
            const files = readDirRecursive(dirPath);

            if (files) {
                for (let j = 0; j < files.length; j++) {
                    const fileName = files[j];

                    for (const parserSetKey of this.parsers.keys()) {
                        if (fileName.endsWith(parserSetKey)) {
                            for (const parser of this.parsers.get(parserSetKey)) {
                                parser.parseFile(fileName, names);
                            }
                        }
                    }
                }
            }
        }

        return names;
    }
}