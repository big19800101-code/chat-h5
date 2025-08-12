// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";

function initials(name){ return (name||'游客').slice(0,2).toUpperCase() }
function fmtTime(d){ return new Date(d).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) }
function isSameDay(a,b){
  const da=new Date(a), db=new Date(b);
  return da.getFullYear()===db.getFullYear() && da.getMonth()===db.getMonth() && da.getDate()===db.getDate();
}

export default function App(){
  const ROOM = 'lobby';
  const [me] = useState("游客" + Math.floor(Math.random()*1000));
  const [input, setInput] = useState("");
  const [items, setItems] = useState([]);

  const listRef = useRef(null);
  const endRef  = useRef(null);
  const [atBottom, setAtBottom] = useState(true);

  // 1) 首次加载历史消息
  useEffect(()=>{
    (async ()=>{
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room', ROOM)
        .order('created_at', { ascending: true })
        .limit(200);
      if(!error && data) setItems(data);
    })();
  }, []);

  // 2) Realtime 订阅：只保留这一套（按房间过滤）
  useEffect(()=>{
    const channel = supabase
      .channel(`room:${ROOM}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room=eq.${ROOM}`
      }, (payload) => {
        setItems(v => [...v, payload.new]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // 分组：日期分割线
  const timeline = useMemo(()=>{
    const out = [];
    let prev = null;
    items.forEach(m=>{
      if(!prev || !isSameDay(prev.created_at, m.created_at)){
        out.push({ type:'sep', id:'sep-'+(m.id||m.created_at), label: new Date(m.created_at).toLocaleDateString() });
      }
      out.push({ type:'msg', ...m });
      prev = m;
    });
    return out;
  }, [items]);

  useEffect(()=>{
    const el = listRef.current;
    function onScroll(){
      if(!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      setAtBottom(nearBottom);
    }
    el?.addEventListener('scroll', onScroll);
    return ()=> el?.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(()=>{
    if(atBottom){
      endRef.current?.scrollIntoView({ behavior:'smooth' });
    }
  }, [timeline, atBottom]);

  async function send(){
    const text = input.trim();
    if(!text) return;
    setInput("");

    // 乐观更新（先展示，再让服务端写库）
    const optimistic = { id: `tmp-${Date.now()}`, user_name: me, text, room: ROOM, created_at: new Date().toISOString() };
    setItems(v => [...v, optimistic]);

    const { error } = await supabase.from('messages').insert([
      { room: ROOM, user_name: me, text }
    ]);
    if(error){
      // 失败则回滚乐观消息
      setItems(v => v.filter(x => x.id !== optimistic.id));
      alert('发送失败：' + error.message);
    }
  }

  function onKey(e){
    const onlyEnter = e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey;
    const cmdEnter  = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
    if (onlyEnter || cmdEnter) { e.preventDefault(); send(); }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="logo" />
        <div>
          <h1>聊天 H5</h1>
          <div className="sub">已接入 Supabase · 实时同步</div>
        </div>
      </header>

      <section className="panel">
        <div className="list" ref={listRef}>
          {timeline.map(node=>{
            if(node.type==='sep'){
              return <div key={node.id} className="day-sep">— {node.label} —</div>
            }
            const mine = node.user_name===me;
            return (
              <div key={node.id} className={`row ${mine?'me':''}`}>
                <div className="avatar" title={node.user_name}>{initials(node.user_name)}</div>
                <div>
                  <div className="bubble">{node.text}</div>
                  <div className="meta">{node.user_name} · {fmtTime(node.created_at)}</div>
                </div>
              </div>
            )
          })}
          <div ref={endRef} className="sticky-bottom" />
        </div>

        <div className="composer">
          <textarea
            className="input"
            rows={1}
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
          />
          <button className="btn" onClick={send} disabled={!input.trim()}>发送</button>
        </div>
      </section>

      {!atBottom && (
        <button className="scroll-btn" onClick={()=>endRef.current?.scrollIntoView({behavior:'smooth'})}>
          回到底部
        </button>
      )}
    </div>
  );
}
