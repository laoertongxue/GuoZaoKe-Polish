import type { Reply } from '../shared/types';
export function buildThreads(replies: Reply[], multiple: boolean): Map<string,string> {
  const parents=new Map<string,string>(), floors=new Map<number,Reply>(), members=new Map<string,Reply>();
  for (const reply of [...replies].sort((a,b)=>a.floor-b.floor)) {
    const eligible=multiple || reply.mentions.length<=1;
    if (eligible) {
      const explicit=reply.references.map(f=>floors.get(f)).find(Boolean);
      const inferred=reply.mentions.filter(n=>n!==reply.author).map(n=>members.get(n)).filter((r):r is Reply=>!!r).sort((a,b)=>b.floor-a.floor)[0];
      const parent=explicit||inferred;
      if (parent && parent.id!==reply.id) parents.set(reply.id,parent.id);
    }
    floors.set(reply.floor,reply); members.set(reply.author,reply);
  }
  return parents;
}
