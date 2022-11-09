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
import { Reader } from "../utils/Reader";
import { Stack } from "../utils/Utils";
import { DsonField } from "./DsonField";
import { FieldType } from "./DsonTypes";
import type { UnhashBehavior } from "./UnhashBehavior";

const HEADER_SIZE = 64;
export const MAGIC_NUMBER = 0xB101; //45313

export class DsonHeader {
    magicNr:number;
    revision:number;
    headerLength:number;
    
    meta1Size:number;
    numMeta1Entries:number;
    meta1Offset:number;
    
    numMeta2Entries:number;
    meta2Offset:number;
    
    dataLength:number;
    dataOffset:number;

    constructor() {}

    parse(reader:Reader) {
        this.magicNr = reader.readUint32();
        if (this.magicNr != MAGIC_NUMBER) throw new Error(`Expected magic number to be ${MAGIC_NUMBER} but was ${this.magicNr}`);

        reader.readInt16(); //empty bytes
        this.revision = reader.readUint16();

        this.headerLength = reader.readUint32();
        if (this.headerLength != HEADER_SIZE) throw new Error(`Expected header length to be 64 but was ${this.headerLength}`);

        reader.readUint32(); //zeroes

        this.meta1Size = reader.readUint32();
        this.numMeta1Entries = reader.readUint32();
        this.meta1Offset = reader.readUint32();

        reader.readUint32(); //zeroes2
        reader.readUint32(); //zeroes2
        reader.readUint32(); //zeroes3
        reader.readUint32(); //zeroes3

        this.numMeta2Entries = reader.readUint32();
        this.meta2Offset = reader.readUint32();
        
        reader.readUint32(); //zeroes4

        this.dataLength = reader.readUint32();
        this.dataOffset = reader.readUint32();
    }
}

export class DsonMeta1Block {
    entries:DsonMeta1BlockEntry[] = [];

    constructor() {}

    parse(reader:Reader, header:DsonHeader) {
        for (let i = 0; i < header.numMeta1Entries; i++) {
            const entry = new DsonMeta1BlockEntry();
            entry.parse(reader);
            this.entries.push(entry);
        }
    }
}
export class DsonMeta1BlockEntry {
    parentIdx:number; //-1 means root
    meta2EntryIdx:number;
    numDirectChildren:number;
    numAllChildren:number;

    constructor() {}

    parse(reader:Reader) {
        this.parentIdx = reader.readInt32();
        this.meta2EntryIdx = reader.readUint32();
        this.numDirectChildren = reader.readUint32();
        this.numAllChildren = reader.readUint32();
    }
}


export class DsonMeta2Block {
    entries:DsonMeta2BlockEntry[] = [];

    constructor() {}

    parse(reader:Reader, header:DsonHeader) {
        for (let i = 0; i < header.numMeta2Entries; i++) {
            const entry = new DsonMeta2BlockEntry();
            entry.parse(reader);
            this.entries.push(entry);
        }
    }

    findNextSmallestOffset(offset:number): number {
        let bestIdx = -1;
        let bestOffset = -1;
        for (let i = 0; i < this.entries.length; i++) {
            if (this.entries[i].offset > offset && (bestIdx == -1 || this.entries[i].offset < bestOffset)) {
                bestIdx = i;
                bestOffset = this.entries[i].offset;
                break; // I feel like this will cause issues
            }
        }
        return bestOffset;
    }
}
export class DsonMeta2BlockEntry {
    nameHash:number;
    offset:number; //offset in data block relative to the dataOffset
    fieldInfo:number;
    isObject:boolean;
    nameLen:number; //name length with 0
    meta1BlockIdx:number;

    constructor() {}

    parse(reader:Reader) {
        this.nameHash = reader.readUint32();
        this.offset = reader.readUint32();
        this.fieldInfo = reader.readUint32();
        this.isObject = (this.fieldInfo & 0b1) == 1;
        this.nameLen = (this.fieldInfo & 0b11111111100) >> 2;
        this.meta1BlockIdx = (this.fieldInfo & 0b1111111111111111111100000000000) >> 11;
    }
}

const decoder = new TextDecoder();

export class DsonData {
    rootFields:DsonField[];
    
    constructor() {}

    parse(reader:Reader, dson:DsonFile, unhashBehavior:UnhashBehavior) {
        const fieldStack = new Stack();
        const parentIdxStack = new Stack();

        let runningObjIdx = -1;
        parentIdxStack.push(runningObjIdx);
        const rootFields:DsonField[] = [];

        for (let i = 0; i < dson.meta2Block.entries.length; i++) {
            const meta2Entry = dson.meta2Block.entries[i];
            const field = new DsonField();
            field.name = DsonData.readName(reader, meta2Entry.offset, meta2Entry.nameLen-1);
            
            if (meta2Entry.isObject) {
                field.meta1EntryIdx = meta2Entry.meta1BlockIdx;
            }
            field.meta2EntryIdx = i;
            reader.seek(1, 1);
            field.dataStartInFile = reader.offset;

            let nextOff = dson.meta2Block.findNextSmallestOffset(meta2Entry.offset);
            let dataLen:number;

            if (nextOff > 0) {
                dataLen = nextOff - field.dataStartInFile;
            } else {
                dataLen = dson.header.dataLength - field.dataStartInFile; //accounts for dataStart being relative to begging of reader
            }

            field.rawData = reader.readSignedBytes(dataLen);

            if (meta2Entry.isObject) {
                field.type = FieldType.TYPE_OBJECT;
                field.setNumChildren(dson.meta1Block.entries[meta2Entry.meta1BlockIdx].numDirectChildren);

                if (dson.meta1Block.entries[meta2Entry.meta1BlockIdx].parentIdx != parentIdxStack.peek()) {
                    throw new Error("Parent object not most recently parsed object");
                }

                runningObjIdx++;
            }

            if (fieldStack.isEmpty()) {
                if (field.type != FieldType.TYPE_OBJECT) {
                    throw new Error("No top level object in dson");
                } else {
                    rootFields.push(field);
                }
            } else {
                if (!fieldStack.peek().addChild(field)) {
                    throw new Error("Failed to add child");
                }
            }

            if (field.type != FieldType.TYPE_OBJECT) {
                if (!field.guessType(unhashBehavior)) {
                    console.log(`Failed to parse field: ${field.name}`);
                }
            }

            if (field.type == FieldType.TYPE_OBJECT) {
                fieldStack.push(field);
                parentIdxStack.push(runningObjIdx);
            }

            while (!fieldStack.isEmpty() && JSON.stringify(fieldStack.peek().type) == JSON.stringify(FieldType.TYPE_OBJECT) && fieldStack.peek().hasAllChildren()) {
                fieldStack.pop();
                parentIdxStack.pop();
            }
        }
        
        if (!fieldStack.isEmpty()) {
            throw new Error("Not all fields have recieved children");
        }
        if (runningObjIdx + 1 != dson.header.numMeta1Entries) {
            throw new Error("Wrong number of fields");
        }

        this.rootFields = rootFields;
    }

    static readName(reader:Reader, offset:number, nameLength:number): string {
        reader.seek(offset);
        const res = decoder.decode(reader.readSignedBytes(nameLength));
        return res;
    }

    writeField(field:DsonField):any {
        if (field.type == FieldType.TYPE_OBJECT) {
            return this.writeObject(field);
        } else if (field.type == FieldType.TYPE_FILE) {
            return field.embeddedFile.asJson();
        } else {
            return field.dataValue;
        }
    }

    writeObject(field:DsonField):any {
        if (field.children.length > 0) {
            const uniqueFields = new Set<string>();
            const res = {};

            for (let i = 0; i < field.children.length; i++) {
                const cField = field.children[i];
                if (!uniqueFields.has(cField.name)) {
                    res[cField.name] = this.writeField(cField);
                    uniqueFields.add(cField.name);
                }
            }

            return res;
        } else {
            return {};
        }
    }

    asJson(): Object {
        const res = {};

        for (let i = 0; i < this.rootFields.length; i++) {
            const rootField = this.rootFields[i];
            res[rootField.name] = this.writeField(rootField);
        }

        return res;
    }
}

export class DsonFile {
    header:DsonHeader;
    meta1Block:DsonMeta1Block;
    meta2Block:DsonMeta2Block;
    data:DsonData

    constructor(reader:Reader, behavior:UnhashBehavior) {
        this.header = new DsonHeader();
        this.header.parse(reader);

        reader.seek(this.header.meta1Offset);
        this.meta1Block = new DsonMeta1Block();
        this.meta1Block.parse(reader, this.header);
        
        reader.seek(this.header.meta2Offset);
        this.meta2Block = new DsonMeta2Block();
        this.meta2Block.parse(reader, this.header);

        reader.seek(this.header.dataOffset);
        this.data = new DsonData();
        this.data.parse(new Reader(reader.data.slice(this.header.dataOffset, this.header.dataOffset + this.header.dataLength)), this, behavior);
    }

    asJson(): Object {
        return this.data.asJson();
    }
}