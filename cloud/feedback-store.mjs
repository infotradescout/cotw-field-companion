import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';

export const FEEDBACK_CATEGORIES=Object.freeze(['bug','idea','data','ui','other']);
const CONTROL=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function text(value,max,name,{required=false}={}){
  if(typeof value!=='string'){
    if(!required&&(value===undefined||value===null))return null;
    throw Object.assign(Error(`${name} must be text`),{status:400});
  }
  const clean=value.replace(/\r\n?/g,'\n').trim();
  if(required&&!clean)throw Object.assign(Error(`${name} is required`),{status:400});
  if(clean.length>max)throw Object.assign(Error(`${name} is too long`),{status:400});
  if(CONTROL.test(clean))throw Object.assign(Error(`${name} contains unsupported characters`),{status:400});
  return clean||null;
}

export function normalizeFeedbackInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(Error('A JSON object is required'),{status:400});
  const allowed=new Set(['category','message','replyTo','page','build','website']);
  if(Object.keys(input).some(key=>!allowed.has(key)))throw Object.assign(Error('Unsupported feedback field'),{status:400});
  if(input.website!==undefined&&input.website!==null&&String(input.website).trim())throw Object.assign(Error('Feedback could not be accepted'),{status:400});
  const category=text(input.category,16,'category',{required:true});
  if(!FEEDBACK_CATEGORIES.includes(category))throw Object.assign(Error('Unknown feedback category'),{status:400});
  const message=text(input.message,4000,'message',{required:true});
  const replyTo=text(input.replyTo,254,'replyTo');
  if(replyTo&&(!/^\S+@\S+\.\S+$/.test(replyTo)||replyTo.includes('\n')))throw Object.assign(Error('replyTo must be an email address'),{status:400});
  return {category,message,replyTo,page:text(input.page,100,'page'),build:text(input.build,64,'build')};
}

export class FeedbackStore{
  constructor(filename=':memory:'){
    this.db=new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS feedback(
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        reply_to TEXT,
        page TEXT,
        build TEXT,
        status TEXT NOT NULL CHECK(status IN ('new','read')),
        read_at TEXT
      );
      CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback(created_at DESC);
      CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback(status,created_at DESC);`);
  }
  create(input,{now=new Date().toISOString()}={}){
    const value=normalizeFeedbackInput(input),id=randomUUID();
    this.db.prepare('INSERT INTO feedback(id,created_at,category,message,reply_to,page,build,status,read_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,now,value.category,value.message,value.replyTo,value.page,value.build,'new',null);
    return this.get(id);
  }
  get(id){
    const row=this.db.prepare('SELECT id,created_at,category,message,reply_to,page,build,status,read_at FROM feedback WHERE id=?').get(id);
    return row?this.#public(row):null;
  }
  list({status='all',limit=50}={}){
    if(!['all','new','read'].includes(status))throw Object.assign(Error('Invalid feedback status'),{status:400});
    const size=Math.max(1,Math.min(100,Number(limit)||50));
    const rows=status==='all'
      ?this.db.prepare('SELECT id,created_at,category,message,reply_to,page,build,status,read_at FROM feedback ORDER BY created_at DESC LIMIT ?').all(size)
      :this.db.prepare('SELECT id,created_at,category,message,reply_to,page,build,status,read_at FROM feedback WHERE status=? ORDER BY created_at DESC LIMIT ?').all(status,size);
    return rows.map(row=>this.#public(row));
  }
  unreadCount(){return Number(this.db.prepare("SELECT COUNT(*) AS count FROM feedback WHERE status='new'").get().count);}
  markRead(id,now=new Date().toISOString()){
    this.db.prepare("UPDATE feedback SET status='read',read_at=? WHERE id=? AND status='new'").run(now,id);
    return this.get(id);
  }
  #public(row){return {id:row.id,createdAt:row.created_at,category:row.category,message:row.message,replyTo:row.reply_to||null,page:row.page||null,build:row.build||null,status:row.status,readAt:row.read_at||null};}
  close(){this.db.close();}
}
