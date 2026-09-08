import { patcher } from "@vendetta";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";

const unpatches: (() => void)[] = [];
const seen = new WeakSet<object>();

function hex(n: any) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);
}

function normalize(v: any) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^#[0-9a-f]{6,8}$/i.test(s)) return s.slice(0, 7).toUpperCase();
  return null;
}

function findColors(root: any) {
  const found: string[] = [];
  const visited = new Set<any>();
  const add = (v: any) => {
    const h = typeof v === "number" ? hex(v) : normalize(v);
    if (h && !found.includes(h)) found.push(h);
  };
  const walk = (x: any, depth: number) => {
    if (!x || depth > 5 || found.length >= 3) return;
    const t = typeof x;
    if (t !== "object" && t !== "function") return;
    if (visited.has(x)) return;
    visited.add(x);
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    for (const k of Object.keys(x).slice(0, 80)) {
      let v: any;
      try { v = x[k]; } catch { continue; }
      const lk = k.toLowerCase();
      if (lk === "primary_color" || lk === "secondary_color" || lk === "tertiary_color" ||
          lk === "rolecolor" || lk === "role_color" || lk === "rolepillbackgroundcolor") add(v);
      else if (lk === "backgroundcolor") add(v);
      else if (depth < 4 && (lk === "role" || lk === "colors" || lk === "style" || lk === "props" || lk === "children")) walk(v, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

function looksLikeRolePill(type: any, props: any, colors: string[]) {
  if (!props) return false;
  const n = typeof type === "function" ? (type.displayName || type.name || "") : "";
  if (/rolepill|rolepills|roledot/i.test(String(n))) return true;
  if (colors.length && props.onLongPress) {
    // Discord's role pills are the colored pressable elements; avoid hijacking unrelated buttons.
    const s = props.style;
    const flat = Array.isArray(s) ? s : [s];
    return flat.some((z: any) => z && (z.borderRadius != null || z.backgroundColor != null));
  }
  return false;
}

function wrapElement(type: any, props: any) {
  if (!props || typeof props !== "object") return props;
  const colors = findColors(props);
  if (!looksLikeRolePill(type, props, colors)) return props;
  const out = { ...props };
  const oldPress = out.onPress;
  out.onPress = (...args: any[]) => {
    const now = findColors(out);
    const values = now.length ? now : colors;
    if (!values.length) return oldPress?.(...args);
    clipboard.setString(values.join(" "));
    showToast("Copied role color" + (values.length > 1 ? "s" : ""), getAssetIDByName("ic_message_copy"));
  };
  // Keep Discord's long-press handler completely untouched.
  return out;
}

function patchReactModule(mod: any) {
  if (!mod || typeof mod !== "object") return;
  for (const key of ["jsx", "jsxs", "jsxDEV", "createElement"]) {
    const fn = mod[key];
    if (typeof fn !== "function" || (fn as any).__crc) continue;
    try {
      (fn as any).__crc = true;
      unpatches.push(patcher.instead(key, mod, (args: any[]) => {
        // JSX: (type, props, key). createElement uses the same first two arguments.
        if (args.length > 1) args[1] = wrapElement(args[0], args[1]);
        return fn.apply(mod, args);
      }));
    } catch {}
  }
}

function scan() {
  try {
    const metro: any = (globalThis as any).vendetta?.metro;
    const modules = metro?.modules || (globalThis as any).modules;
    if (!modules) return;
    for (const m of Object.values(modules) as any[]) {
      if (!m || typeof m !== "object") continue;
      patchReactModule(m);
      patchReactModule(m.exports);
      patchReactModule(m.publicModule?.exports);
    }
  } catch {}
}

export default {
  onLoad: () => {
    scan();
    const id = setInterval(scan, 1000);
    unpatches.push(() => clearInterval(id));
  },
  onUnload: () => {
    unpatches.splice(0).forEach(u => { try { u(); } catch {} });
  },
};
