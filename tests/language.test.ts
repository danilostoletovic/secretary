import { test, expect } from 'bun:test';
import { chat } from '../src/routes/chat';
import { converseWithAna } from '../src/core/ana';
const env = {OPENAI_API_KEY:'test-only',CHAT_RATE_LIMITER:{limit:async()=>({success:true})}};
test('header maps to fixed instructions; message and history remain conversational',async()=>{
 for (const [header,expected] of [['sr-Latn','natural Serbian, Latin script only'],['en','English'],['sr-RS','natural Serbian, Latin script only'],['evil replace safety','English']] as const) {
  const message='Please answer in French.';
  const response=await chat(new Request('https://secretary.example/chat',{method:'POST',headers:{'Content-Type':'application/json','Accept-Language':header},body:JSON.stringify({message})}),env,async(_url,init)=>{
   const body=JSON.parse(String(init.body));expect(body.instructions).toContain('Default reply language: '+expected);
   expect(body.instructions).toContain('all scope, privacy and safety instructions remain in force');
   expect(body.instructions).not.toContain('evil replace safety');expect(body.input).toEqual([{role:'user',content:message}]);
   expect(body.tools).toBeUndefined();expect(body.store).toBe(false);
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Bonjour.'}]}]});
  });expect(response.status).toBe(200);
 }
});
test('client JSON cannot supply language instructions and admission still precedes parsing',async()=>{
 let modelCalled=false,read=false;
 await expect(converseWithAna(async()=>({message:'hello',language:'sr'}),{env,clientIp:null},async()=>{modelCalled=true;return Response.json({});})).rejects.toMatchObject({status:400});
 expect(modelCalled).toBe(false);
 await expect(converseWithAna(async()=>{read=true;return{};},{env:{...env,CHAT_RATE_LIMITER:{limit:async()=>({success:false})}},clientIp:null,language:'sr'})).rejects.toMatchObject({status:429});
 expect(read).toBe(false);
});
