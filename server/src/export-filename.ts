import {z} from 'zod';
export const exportPrefix=z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/,'Use 1-60 letters, digits, underscores or hyphens, starting with a letter or digit');
export function exportFilename(prefix:unknown,kind:'run1'|'run2'|'preferred'|'decisions',fallback:string){
 const value=prefix??process.env.EXPORT_FILENAME_PREFIX;
 return value===undefined?fallback:`${exportPrefix.parse(value)}__${kind}.csv`;
}
