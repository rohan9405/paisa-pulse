import type {FinanceDB} from '@/data/db';
import {DB_NAMES} from '@/data/db';
import {seedDemo} from '@/data/repo';
import type {AppMode} from '@/lib/types';
export async function resetTracking(db:FinanceDB,mode:AppMode,today:string){
 if(db.name!==DB_NAMES[mode])throw new Error('The selected tracking database does not match the app mode.');
 await db.transaction('rw',db.tables,async()=>{for(const table of db.tables)await table.clear();if(mode==='demo')await seedDemo(db,today);});
}
