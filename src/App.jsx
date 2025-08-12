// src/App.jsx
import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { supabase } from "./lib/supabase";

// === Pixel Clock（3x5 像素时钟）====
const FONT = {
  "0": ["111","101","101","101","111"],
  "1": ["010","110","010","010","111"],
  "2": ["111","001","111","100","111"],
  "3": ["111","001","111","001","111"],
  "4": ["101","101","111","001","001"],
  "5": ["111","100","111","001","111"],
  "6": ["111","100","111","101","111"],
  "7": ["111","001","010","010","010"],
  "8": ["111","101","111","101","111"],
  "9": ["111","101","111","001","111"],
  ":": ["000","010","000","010","000"],
};
function PixelChar({ ch, scale = 4 }) {
  const pattern = FONT[ch] || ["000","000","000","000","000"];
  const cell = Math.max(2, scale);
  const gap = Math.max(1, Math.floor(scale / 3));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${pattern[0].length}, ${cell}px)`,
        gridAutoRows: `${cell}px`,
        gap,
      }}
    >
      {pattern.flatMap((row, r) =>
        row.split("").map((bit, c) => (
          <div
            key={`${r}-${c}`}
            style={{
              background: bit === "1" ? "#00ff66" : "transparent",
              boxShadow: bit === "1" ? "0 0 4px #00ff66, 0 0 8px #00ff66" : "none",
              borderRadius: 1,
            }}
          />
        ))
      )}
    </div>
  );
}
function PixelClock({ scale = 4 }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString("zh-CN", {
    hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: scale * 1.2 }} title={time}>
      {time.split("").map((ch, i) => <PixelChar key={i} ch={ch} scale={scale} />)}
    </div>
  );
}
// === /Pixel Clock ====


// --- 颜色：固定 + 稳定“伪随机” ---
const FIXED = { 1: "#fecaca", 2: "#bbf7d0", 3: "#ddd6fe" };
const PALETTE = ["#fee2e2", "#dcfce7", "#ede9fe", "#e0f2fe", "#fff7ed", "#fef9c3", "#fce7f3", "#d1fae5"];
function hashString(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function colorFor(key) { const asNum = Number(key); if (!Number.isNaN(asNum) && FIXED[asNum]) return FIXED[asNum]; const idx = hashString(String(key)) % PALETTE.length; return PALETTE[idx]; }

// --- 小工具 ---
function initials(name) { return (name || "游客").slice(0, 2); }
function fmtTime(d) { return new Date(d).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }); }
function isSameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

// --- 只保留最近 N 小时 ---
const WINDOW_HOURS = 3;
function windowStartISO() { return new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString(); }
function trimToWindow(list) { const since = new Date(windowStartISO()).getTime(); return list.filter(m => new Date(m.created_at).getTime() >= since); }
function mergeById(prev, incoming) {
  const map = new Map();
  const put = (m) => {
    const key = m.id ?? `${m.created_at}-${m.user_name}-${m.text}`;
    const old = map.get(key);
    map.set(key, { ...(old || {}), ...m });
  };
  prev.forEach(put); incoming.forEach(put);
  const out = Array.from(map.values()).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return trimToWindow(out);
}

/** ================= Pixel Snake Border =================
 * 在目标容器外侧沿矩形周长像素化爬行的贪吃蛇
 */
function SnakeBorder({
  targetRef,
  pixel = 6,         // 单个像素大小（方块边长）
  margin = 8,        // 与目标外边的间距（蛇在“外圈”）
  speed = 80,        // 像素/秒
  length = 70,       // 身体方块数
  color = "#00ff66", // 霓虹绿
  glow = true,
}) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const headRef = useRef(0);
  const pathRef = useRef([]);

  // 构建沿矩形外圈的像素路径
  function buildPath(w, h, step) {
    // 取能被 step 整除的尺寸，保证像素对齐
    const W = Math.max(step, Math.floor(w / step) * step);
    const H = Math.max(step, Math.floor(h / step) * step);
    const pts = [];

    // 以 step 为栅格，走一个外圈（从左上角顺时针）
    const right = W - step;
    const bottom = H - step;

    for (let x = 0; x <= right; x += step) pts.push([x, 0]);         // 顶边
    for (let y = step; y <= bottom; y += step) pts.push([right, y]);  // 右边
    for (let x = right - step; x >= 0; x -= step) pts.push([x, bottom]); // 底边
    for (let y = bottom - step; y >= step; y -= step) pts.push([0, y]);  // 左边

    return pts;
  }

  // 尺寸与路径更新
  useEffect(() => {
    if (!targetRef?.current || !canvasRef.current) return;

    const cvs = canvasRef.current;
    const parent = targetRef.current;

    const ro = new ResizeObserver(() => {
      const rect = parent.getBoundingClientRect();
      // 画布比目标略大，放在外圈
      const w = Math.ceil(rect.width + margin * 2);
      const h = Math.ceil(rect.height + margin * 2);

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      cvs.style.width = w + "px";
      cvs.style.height = h + "px";
      cvs.width = Math.floor(w * dpr);
      cvs.height = Math.floor(h * dpr);

      const ctx = cvs.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 重新生成路径
      pathRef.current = buildPath(w, h, pixel);
    });

    ro.observe(parent);
    return () => ro.disconnect();
  }, [targetRef, pixel, margin]);

  // 动画循环
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");

    let last = performance.now();

    function frame(t) {
      const delta = (t - last) / 1000; // s
      last = t;

      const path = pathRef.current;
      if (path.length === 0) {
        animRef.current = requestAnimationFrame(frame);
        return;
      }

      // 推进头部位置
      const advance = (speed * delta) / pixel; // 以“点”为单位的增量
      headRef.current = (headRef.current + advance) % path.length;

      // 清屏（透明），只保留蛇
      ctx.clearRect(0, 0, cvs.width, cvs.height);

      // 绘制身体（从头往回 length 个点）
      if (glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = color;

      for (let i = 0; i < length; i++) {
        // 头部 index 可能是小数，插值不必要，这里四舍五入取近点
        const idx = Math.floor(headRef.current - i);
        const loopIdx = ((idx % path.length) + path.length) % path.length;
        const [x, y] = path[loopIdx];
        ctx.fillRect(x, y, pixel, pixel);
      }

      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [pixel, speed, length, color, glow]);

  // 让画布覆盖到目标外圈：绝对定位在目标的“外侧”
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        left: -margin,
        top: -margin,
        pointerEvents: "none",
        zIndex: 9, // 在列表之上、composer之下（composer zIndex:10 时，蛇会被 composer 盖住底部一段，更真实）
      }}
    />
  );
}

export default function App() {
  const ROOM = "lobby";
  const [me] = useState("游客" + Math.floor(Math.random() * 1000));
  const [input, setInput] = useState("");
  const [items, setItems] = useState([]);

  const listRef = useRef(null);
  const endRef = useRef(null);
  const composerRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null); // ⭐ 聊天面板 ref，给 SnakeBorder 用

  const [atBottom, setAtBottom] = useState(true);
  const [kbOpen, setKbOpen] = useState(false); // 软键盘是否打开（移动端）
  const [composerH, setComposerH] = useState(56); // composer 高度
  const [viewportInset, setViewportInset] = useState(0); // 软键盘/安全区 增加的底部空隙
  const didInitialScroll = useRef(false);
  const lastTsRef = useRef(null);
  const pollTimerRef = useRef(null);

  const isMobile = typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)").matches : false;

  // 观测 composer 高度（用于占位）
  useLayoutEffect(() => {
    const measure = () => {
      if (composerRef.current) setComposerH(composerRef.current.offsetHeight || 56);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (composerRef.current) ro.observe(composerRef.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  // 观测 visualViewport（iOS/Android 软键盘）
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const inset = Math.max(0, (window.innerHeight - vv.height) | 0);
      setViewportInset(inset);
      if (kbOpen && endRef.current) {
        endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [kbOpen]);

  // ✅ Realtime + 兜底轮询（只保留最近 3 小时）
  useEffect(() => {
    let isMounted = true;
    const stopPolling = () => { if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; } };
    const startPolling = (fn) => { if (!pollTimerRef.current) { pollTimerRef.current = setInterval(fn, 2000); } };
    const fetchLatest = async () => {
      const base = supabase.from("messages").select("*").eq("room", ROOM).order("created_at", { ascending: true }).limit(200);
      const cursor = lastTsRef.current || windowStartISO();
      const q = cursor ? base.gte("created_at", cursor) : base;
      const { data, error } = await q;
      if (!isMounted) return;
      if (error) return;
      if (data && data.length) {
        setItems(v => mergeById(v, data));
        lastTsRef.current = data[data.length - 1].created_at;
      }
    };
    (async () => {
      const { data, error } = await supabase.from("messages")
        .select("*").eq("room", ROOM).gte("created_at", windowStartISO())
        .order("created_at", { ascending: true }).limit(200);
      if (!isMounted) return;
      if (!error && data) {
        setItems(trimToWindow(data));
        if (data.length) lastTsRef.current = data[data.length - 1].created_at;
        setTimeout(() => {
          endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
          didInitialScroll.current = true;
        }, 0);
      }
    })();
    const channel = supabase.channel(`room:${ROOM}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        if (!isMounted) return;
        const m = payload?.new;
        if (m?.room === ROOM) {
          setItems(v => mergeById(v, [m]));
          lastTsRef.current = m.created_at;
          stopPolling();
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") stopPolling();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") startPolling(fetchLatest);
      });
    const fallback = setTimeout(() => { if (!pollTimerRef.current) startPolling(fetchLatest); }, 5000);
    const janitor = setInterval(() => {
      setItems(v => trimToWindow(v));
      if (items.length === 0) lastTsRef.current = windowStartISO();
    }, 60 * 1000);
    return () => { isMounted = false; clearTimeout(fallback); clearInterval(janitor); stopPolling(); supabase.removeChannel(channel); };
  }, []);

  // 分组：日期分割线
  const timeline = useMemo(() => {
    const out = []; let prev = null;
    items.forEach((m) => {
      if (!prev || !isSameDay(prev.created_at, m.created_at)) {
        out.push({ type: "sep", id: "sep-" + (m.id || m.created_at), label: new Date(m.created_at).toLocaleDateString("zh-CN") });
      }
      out.push({ type: "msg", ...m }); prev = m;
    });
    return out;
  }, [items]);

  // 滚动 & 回到底部
  useEffect(() => {
    const el = listRef.current;
    function onScroll() {
      if (!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      setAtBottom(nearBottom);
    }
    el?.addEventListener("scroll", onScroll);
    return () => el?.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (didInitialScroll.current && atBottom) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [timeline, atBottom]);

  // 发送
  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const optimistic = { id: `tmp-${Date.now()}`, user_name: me, text, room: ROOM, created_at: new Date().toISOString() };
    setItems(v => mergeById(v, [optimistic]));
    const { data, error } = await supabase.from("messages").insert([{ room: ROOM, user_name: me, text }]).select();
    if (error) {
      setItems(v => v.filter(x => x.id !== optimistic.id));
      alert("发送失败：" + error.message);
    } else if (data && data[0]) {
      setItems(v => mergeById([], v.map(x => x.id === optimistic.id ? data[0] : x)));
      lastTsRef.current = data[0].created_at;
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    if (isMobile && inputRef.current) {
      inputRef.current.focus();
    }
  }
  function onKey(e) {
    const onlyEnter = e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey;
    const cmdEnter = e.key === "Enter" && (e.metaKey || e.ctrlKey);
    if (onlyEnter || cmdEnter) { e.preventDefault(); send(); }
  }

  // ====== 样式计算：确保手机端键盘弹出时按钮可见 ======
  const floatingComposer = isMobile && kbOpen;
  const safeBottom = `env(safe-area-inset-bottom, 0px)`;
  const listExtraPad = floatingComposer ? `calc(${composerH}px + ${safeBottom})` : "0px";

  return (
    <div
      className="app"
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "#000",        // ⭐ 整体黑底
        color: "#e5e7eb",
      }}
    >
      <header
        className="header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          position: "sticky",
          top: 0,
          background: "#000",      // ⭐ 黑色
          zIndex: 5,
          borderBottom: "1px solid #111",
        }}
      >
        <div className="logo" />
        <div>
          <h1 style={{ margin: 0, fontSize: 18, color: "#f3f4f6" }}>聊天 H5</h1>
          <div className="sub" style={{ fontSize: 12, color: "#9ca3af" }}>Supabase 实时 · 稳定着色 · 最近{WINDOW_HOURS}小时窗口</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <PixelClock scale={4} />
        </div>
      </header>

      <section
        className="panel"
        ref={panelRef}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          position: "relative", // ⭐ 让蛇能绝对定位在其外圈
          background: "#000",
        }}
      >
        {/* 像素贪吃蛇边框 */}
        <SnakeBorder targetRef={panelRef} pixel={6} margin={10} speed={90} length={90} color="#00ff66" />

        <div
          className="list"
          ref={listRef}
          style={{
            overflowY: "auto",
            padding: "8px 12px",
            paddingBottom: listExtraPad,
          }}
        >
          {timeline.map((node) => {
            if (node.type === "sep") {
              return (
                <div key={node.id} className="day-sep" style={{ textAlign: "center", color: "#9ca3af", margin: "10px 0" }}>
                  — {node.label} —
                </div>
              );
            }
            const colorKey = node.user_id ?? node.user_name ?? "unknown";
            const bg = colorFor(colorKey);
            const mine = node.user_name === me;
            return (
              <div
                key={node.id}
                className={`row ${mine ? "me" : ""}`}
                style={{ display: "flex", gap: 8, marginBottom: 8, flexDirection: mine ? "row-reverse" : "row" }}
              >
                <div
                  className="avatar"
                  title={node.user_name}
                  style={{
                    background: bg,
                    color: "#111",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    flex: "0 0 auto",
                  }}
                >
                  {initials(node.user_name)}
                </div>
                <div>
                  <div
                    className="bubble"
                    style={{
                      background: bg,
                      borderColor: "transparent",
                      color: "#111",
                      borderRadius: 10,
                      padding: "8px 10px",
                      maxWidth: "72vw",
                      wordBreak: "break-word",
                    }}
                  >
                    {node.text}
                  </div>
                  <div className="meta" style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                    {node.user_name} · {fmtTime(node.created_at)}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} className="sticky-bottom" />
        </div>

        {/* 悬浮 composer（移动端键盘弹出时） */}
        <div
          ref={composerRef}
          className="composer"
          style={{
            display: "flex",
            gap: 8,
            padding: "8px 12px",
            borderTop: "1px solid #111",
            background: "#000", // ⭐ 黑色
            ...(floatingComposer
              ? {
                  position: "fixed",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  paddingBottom: `max(8px, env(safe-area-inset-bottom, 0px))`,
                  zIndex: 10,
                }
              : { position: "static" }),
          }}
        >
          <textarea
            ref={inputRef}
            className="input"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => setKbOpen(true)}
            onBlur={() => setKbOpen(false)}
            placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
            style={{
              flex: 1,
              resize: "none",
              border: "1px solid #333",
              background: "#000",
              color: "#e5e7eb",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 14,
              lineHeight: 1.3,
              maxHeight: 120,
              outline: "none",
            }}
          />
          <button
            className="btn"
            onClick={send}
            disabled={!input.trim()}
            style={{
              flex: "0 0 auto",
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #333",
              background: input.trim() ? "#00ff66" : "#222",
              color: input.trim() ? "#111" : "#666",
              fontSize: 14,
              boxShadow: input.trim() ? "0 0 8px #00ff66" : "none",
            }}
          >
            发送
          </button>
        </div>
      </section>

      {!atBottom && (
        <button
          className="scroll-btn"
          onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })}
          style={{
            position: "fixed",
            right: 12,
            bottom: floatingComposer ? `calc(${composerH + 12}px + env(safe-area-inset-bottom, 0px))` : 12,
            zIndex: 20,
            padding: "8px 10px",
            borderRadius: 999,
            border: "1px solid #333",
            background: "#000",
            color: "#e5e7eb",
          }}
        >
          回到底部
        </button>
      )}
    </div>
  );
}
