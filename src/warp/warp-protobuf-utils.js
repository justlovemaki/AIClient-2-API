/**
 * @file Warp API Protobuf Utilities
 * @description Handles protobuf encoding/decoding for Warp API using protobufjs.
 * Provides utilities for server_message_data encoding, timestamp handling, and varint operations.
 * Uses code generation from .proto files for reliable message serialization.
 * 
 * Key features:
 * - Automatic proto definition loading with google.protobuf.* support
 * - Base64URL encoding/decoding for server_message_data fields
 * - Recursive field transformation for nested structures
 * - google.protobuf.Value conversion for metadata fields
 */

import protobuf from 'protobufjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class WarpProtobufUtils {
    constructor() {
        this.root = null;
        this.messageClasses = {};
    }

    /**
     * Encode server_message_data object to Base64URL string
     */
    encodeServerMessageData(data) {
        if (!data || typeof data !== 'object') {
            return data;
        }

        const { uuid, seconds, nanos } = data;
        const parts = [];

        if (uuid) {
            const uuidBytes = Buffer.from(uuid, 'utf-8');
            parts.push(this.writeVarint((1 << 3) | 2));
            parts.push(this.writeVarint(uuidBytes.length));
            parts.push(uuidBytes);
        }

        if (seconds !== undefined || nanos !== undefined) {
            const timestampBytes = this.encodeTimestamp(seconds, nanos);
            parts.push(this.writeVarint((3 << 3) | 2));
            parts.push(this.writeVarint(timestampBytes.length));
            parts.push(timestampBytes);
        }

        const combined = Buffer.concat(parts);
        return this.base64UrlEncode(combined);
    }

    /**
     * Decode Base64URL server_message_data to object
     */
    decodeServerMessageData(b64url) {
        try {
            const raw = this.base64UrlDecode(b64url);
            let i = 0;
            let uuid = null;
            let seconds = null;
            let nanos = null;

            while (i < raw.length) {
                const [key, newI] = this.readVarint(raw, i);
                i = newI;
                const fieldNo = key >> 3;
                const wireType = key & 0x07;

                if (wireType === 2) {
                    const [len, i2] = this.readVarint(raw, i);
                    i = i2;
                    const data = raw.subarray(i, i + len);
                    i += len;

                    if (fieldNo === 1) {
                        uuid = data.toString('utf-8');
                    } else if (fieldNo === 3) {
                        const ts = this.decodeTimestamp(data);
                        seconds = ts.seconds;
                        nanos = ts.nanos;
                    }
                } else if (wireType === 0) {
                    const [, newI2] = this.readVarint(raw, i);
                    i = newI2;
                } else if (wireType === 1) {
                    i += 8;
                } else if (wireType === 5) {
                    i += 4;
                } else {
                    break;
                }
            }

            const result = {};
            if (uuid !== null) result.uuid = uuid;
            if (seconds !== null) result.seconds = seconds;
            if (nanos !== null) result.nanos = nanos;
            
            return result;
        } catch (error) {
            return { error: error.message, raw_b64url: b64url };
        }
    }

    /**
     * Encode timestamp (seconds, nanos) to protobuf bytes
     */
    encodeTimestamp(seconds, nanos) {
        const parts = [];

        if (seconds !== undefined && seconds !== null) {
            parts.push(this.writeVarint((1 << 3) | 0));
            parts.push(this.writeVarint(seconds));
        }

        if (nanos !== undefined && nanos !== null) {
            parts.push(this.writeVarint((2 << 3) | 0));
            parts.push(this.writeVarint(nanos));
        }

        return Buffer.concat(parts);
    }

    /**
     * Decode timestamp from protobuf bytes
     */
    decodeTimestamp(buf) {
        let i = 0;
        let seconds = null;
        let nanos = null;

        while (i < buf.length) {
            const [key, newI] = this.readVarint(buf, i);
            i = newI;
            const fieldNo = key >> 3;
            const wireType = key & 0x07;

            if (wireType === 0) {
                const [val, newI2] = this.readVarint(buf, i);
                i = newI2;
                if (fieldNo === 1) {
                    seconds = val;
                } else if (fieldNo === 2) {
                    nanos = val;
                }
            } else if (wireType === 2) {
                const [len, i2] = this.readVarint(buf, i);
                i = i2 + len;
            } else if (wireType === 1) {
                i += 8;
            } else if (wireType === 5) {
                i += 4;
            } else {
                break;
            }
        }

        return { seconds, nanos };
    }

    /**
     * Write varint to buffer
     */
    writeVarint(value) {
        const out = [];
        let v = value;

        while (true) {
            const toWrite = v & 0x7F;
            v >>= 7;
            if (v) {
                out.push(toWrite | 0x80);
            } else {
                out.push(toWrite);
                break;
            }
        }

        return Buffer.from(out);
    }

    /**
     * Read varint from buffer
     */
    readVarint(buf, i) {
        let shift = 0;
        let val = 0;

        while (i < buf.length) {
            const b = buf[i];
            i++;
            val |= (b & 0x7F) << shift;
            if (!(b & 0x80)) {
                return [val, i];
            }
            shift += 7;
            if (shift > 63) {
                break;
            }
        }

        throw new Error('Invalid varint');
    }

    /**
     * Base64URL encode (no padding)
     */
    base64UrlEncode(buffer) {
        return buffer.toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    /**
     * Base64URL decode (with padding)
     */
    base64UrlDecode(str) {
        let s = str.replace(/-/g, '+').replace(/_/g, '/');
        const pad = (4 - (s.length % 4)) % 4;
        if (pad) {
            s += '='.repeat(pad);
        }
        return Buffer.from(s, 'base64');
    }

    /**
     * Recursively encode server_message_data in object
     */
    encodeSmdInplace(obj) {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.encodeSmdInplace(item));
        }

        const newObj = {};
        for (const [key, value] of Object.entries(obj)) {
            if ((key === 'server_message_data' || key === 'serverMessageData') && 
                typeof value === 'object' && value !== null && !Array.isArray(value)) {
                try {
                    newObj[key] = this.encodeServerMessageData(value);
                } catch (error) {
                    console.warn(`Failed to encode server_message_data: ${error.message}`);
                    newObj[key] = value;
                }
            } else {
                newObj[key] = this.encodeSmdInplace(value);
            }
        }

        return newObj;
    }

    /**
     * Recursively decode server_message_data in object
     */
    decodeSmdInplace(obj) {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.decodeSmdInplace(item));
        }

        const newObj = {};
        for (const [key, value] of Object.entries(obj)) {
            if ((key === 'server_message_data' || key === 'serverMessageData') && 
                typeof value === 'string') {
                try {
                    newObj[key] = this.decodeServerMessageData(value);
                } catch (error) {
                    console.warn(`Failed to decode server_message_data: ${error.message}`);
                    newObj[key] = value;
                }
            } else {
                newObj[key] = this.decodeSmdInplace(value);
            }
        }

        return newObj;
    }

    /**
     * Load proto definitions
     * Loads both request.proto and response.proto for encoding/decoding
     */
    async loadProtoDefinitions() {
        if (this.root) {
            return this.root;
        }

        try {
            const protoPath = join(__dirname, '..', '..', 'proto');
            
            // Create Root with custom resolvePath for google.protobuf.* imports
            const root = new protobuf.Root();
            
            // Custom path resolver for google/protobuf/* and local files
            root.resolvePath = (origin, target) => {
                // For google/protobuf/* use files from node_modules/protobufjs
                if (/^google\/protobuf\//.test(target)) {
                    return join(__dirname, '..', '..', 'node_modules', 'protobufjs', target);
                }
                
                // If target is absolute path, return as-is
                if (target.includes(':') || target.startsWith('/')) {
                    return target;
                }
                
                // For local files, resolve relative to origin or protoPath
                if (origin) {
                    const originDir = dirname(origin);
                    if (originDir.includes(protoPath)) {
                        return join(originDir, target);
                    }
                }
                
                return join(protoPath, target);
            };

            // Load both request.proto and response.proto
            // keepCase: true to use snake_case like Python implementation
            this.root = await root.load([
                join(protoPath, 'request.proto'),
                join(protoPath, 'response.proto')
            ], { 
                keepCase: true,
                alternateCommentMode: true 
            });
            
            console.log('[Warp Protobuf] Proto definitions loaded successfully');
            return this.root;
        } catch (error) {
            console.error('[Warp Protobuf] Failed to load proto definitions:', error);
            throw error;
        }
    }

    /**
     * Convert JavaScript value to google.protobuf.Value message
     * Uses protobufjs built-in types for proper Value creation
     */
    toProtobufValue(value, ValueType) {
        if (!ValueType) {
            throw new Error('ValueType is required');
        }

        if (value === null || value === undefined) {
            return ValueType.create({ nullValue: 0 });
        }
        if (typeof value === 'boolean') {
            return ValueType.create({ boolValue: value });
        }
        if (typeof value === 'number') {
            return ValueType.create({ numberValue: value });
        }
        if (typeof value === 'string') {
            return ValueType.create({ stringValue: value });
        }
        if (Array.isArray(value)) {
            const ListValueType = this.root.lookupType('google.protobuf.ListValue');
            const listValue = ListValueType.create({
                values: value.map(v => this.toProtobufValue(v, ValueType))
            });
            return ValueType.create({ listValue });
        }
        if (typeof value === 'object') {
            const StructType = this.root.lookupType('google.protobuf.Struct');
            const fields = {};
            for (const [k, v] of Object.entries(value)) {
                fields[k] = this.toProtobufValue(v, ValueType);
            }
            const structValue = StructType.create({ fields });
            return ValueType.create({ structValue });
        }
        return ValueType.create({ stringValue: String(value) });
    }

    /**
     * Convert map<string, google.protobuf.Value> fields
     */
    convertValueMaps(obj) {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.convertValueMaps(item));
        }

        const newObj = {};
        for (const [key, value] of Object.entries(obj)) {
            // Convert metadata.logging map
            if (key === 'logging' && typeof value === 'object' && !Array.isArray(value)) {
                const ValueType = this.root.lookupType('google.protobuf.Value');
                const convertedLogging = {};
                for (const [k, v] of Object.entries(value)) {
                    convertedLogging[k] = this.toProtobufValue(v, ValueType);
                }
                newObj[key] = convertedLogging;
            }
            // Convert call_mcp_tool.args (google.protobuf.Struct)
            else if (key === 'args' && typeof value === 'object' && !Array.isArray(value)) {
                const StructType = this.root.lookupType('google.protobuf.Struct');
                const ValueType = this.root.lookupType('google.protobuf.Value');
                const fields = {};
                for (const [k, v] of Object.entries(value)) {
                    fields[k] = this.toProtobufValue(v, ValueType);
                }
                newObj[key] = StructType.create({ fields });
            } else {
                newObj[key] = this.convertValueMaps(value);
            }
        }

        return newObj;
    }

    /**
     * Convert dictionary to protobuf bytes
     */
    async dictToProtobufBytes(dataDict, messageType = 'warp.multi_agent.v1.Request') {
        try {
            const root = await this.loadProtoDefinitions();
            const MessageType = root.lookupType(messageType);
            
            // Encode server_message_data fields
            let safeDict = this.encodeSmdInplace(dataDict);
            
            // Convert map<string, google.protobuf.Value> fields
            safeDict = this.convertValueMaps(safeDict);
            
            // Add required metadata.conversation_id (matching Python implementation)
            if (!safeDict.metadata) {
                safeDict.metadata = {};
            }
            if (!safeDict.metadata.conversation_id) {
                const { v4: uuidv4 } = await import('uuid');
                safeDict.metadata.conversation_id = `rest-api-${uuidv4().replace(/-/g, '').substring(0, 8)}`;
            }
            
            // Add client version and OS info at root level (matching Python implementation)
            safeDict.client_version = warpConfig.CLIENT_VERSION;
            safeDict.version = warpConfig.CLIENT_VERSION;
            safeDict.os_name = warpConfig.OS_NAME;
            safeDict.os_category = warpConfig.OS_CATEGORY;
            safeDict.os_version = warpConfig.OS_VERSION;
            
            // Verify and encode
            const errMsg = MessageType.verify(safeDict);
            if (errMsg) {
                console.warn('[Warp Protobuf] Verification warning:', errMsg);
            }
            
            const message = MessageType.create(safeDict);
            const buffer = MessageType.encode(message).finish();
            
            console.log(`[Warp Protobuf] Encoded ${buffer.length} bytes`);
            return Buffer.from(buffer);
        } catch (error) {
            console.error('[Warp Protobuf] Encoding failed:', error);
            throw error;
        }
    }

    /**
     * Convert protobuf bytes to dictionary
     */
    async protobufToDict(protobufBytes, messageType) {
        try {
            const root = await this.loadProtoDefinitions();
            const MessageType = root.lookupType(messageType);

            // Normalize input to a Uint8Array for protobufjs
            let bytes = null;
            if (typeof protobufBytes === 'string') {
                // If string, assume it's base64url encoded
                bytes = this.base64UrlDecode(protobufBytes);
            } else if (Buffer.isBuffer(protobufBytes) || protobufBytes instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(protobufBytes))) {
                // Buffer and Uint8Array and other ArrayBuffer views
                // Ensure bytes is a Uint8Array instance (protobufjs accepts Uint8Array)
                bytes = protobufBytes instanceof Uint8Array ? protobufBytes : new Uint8Array(protobufBytes);
            } else if (typeof protobufBytes === 'object' && protobufBytes !== null && typeof protobufBytes.length === 'number') {
                // Fallback for array-like objects
                bytes = new Uint8Array(protobufBytes);
            } else {
                throw new Error('protobufBytes must be Buffer, Uint8Array, or base64url string');
            }

            const message = MessageType.decode(bytes);
            const data = MessageType.toObject(message, {
                longs: String,
                enums: String,
                bytes: String,
                defaults: true,  // Enable defaults to properly decode google.protobuf.Struct
                arrays: true,
                objects: true,
                oneofs: true
            });
            
            return this.decodeSmdInplace(data);
        } catch (error) {
            console.error('[Warp Protobuf] Decoding failed:', error);
            throw error;
        }
    }
}

// Import warpConfig for client version info
import warpConfig from './warp-config.js';

// Export singleton instance
const warpProtobufUtils = new WarpProtobufUtils();
export default warpProtobufUtils;

// Export methods with proper context binding
export const encodeServerMessageData = (data) => warpProtobufUtils.encodeServerMessageData(data);
export const decodeServerMessageData = (b64url) => warpProtobufUtils.decodeServerMessageData(b64url);
