window.__joinAs = async function(code, name, uid){
  try { if (uid) localStorage.setItem("ec_uid", uid); } catch(e){}
  onlineDialog();
  await new Promise(r => setTimeout(r, 300));
  const ov = document.querySelector(".overlay");
  const [n, c] = Array.from(ov.querySelectorAll("input"));
  n.value = name; n.dispatchEvent(new Event("input", { bubbles: true }));
  c.value = code; c.dispatchEvent(new Event("input", { bubbles: true }));
  Array.from(ov.querySelectorAll("button")).find(b => b.textContent.trim() === "Join room").click();
  await new Promise(r => setTimeout(r, 3500));
  return { seat: NET.seat, uid: NET.uid, started: NET.started };
};
window.__roster = function(){
  return (NET.roster||[]).map((r,i) => i + ":" + (r.name||"?") +
    (r.bot ? "(bot)" : r.away ? "(AWAY)" : "(here)"));
};
window.__seatState = function(){
  return { cur: S ? S.cur : null, phase: S ? S.phase : null, turn: S ? S.turnCounter : null,
           agents: Object.keys(window.AGENTS||{}), roster: window.__roster(),
           names: S ? S.players.map(p => p.name) : null };
};
"lobby ready";
