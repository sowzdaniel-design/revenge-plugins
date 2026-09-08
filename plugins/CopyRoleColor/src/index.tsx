import { patcher, metro } from "@vendetta";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";

const unpatches: (() => void)[] = [];
let installed = false;

const MARK = "__copyRoleColor33312";

function hex(n: any) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return "#" + Math.max(0, Math.min(0xffffff, n >>> 0)).toString(16).padStart(6, "0").toUpperCase();
}

function normalizeColor(v: any): string | null {
  if (typeof v === "string") {
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
    if (/^#[0-9a-f]{8}$/i.test(v)) return ("#" + v.slice(-6)).toUpperCase();
  }
  return hex(v);
}

function findColors(value: any, seen = new Set<any>(), depth = 0): string[] {
  if (value == null || depth > 6 || seen.has(value)) return [];
  if (typeof value !== "object" && typeof value !== "function") return [];
  seen.add(value);
  const out: string[] = [];

  const add = (v: any) => { const c = normalizeColor(v); if (c && !out.includes(c)) out.push(c); };

  if (typeof value === "object") {
    for (const k of ["primary_color", "secondary_color", "tertiary_color", "primaryColor", "secondaryColor", "tertiaryColor", "roleColor", "color"]) {
      if (k in value) add(value[k]);
    }
    if (value.colors) {
      for (const k of ["primary_color", "secondary_color", "tertiary_color", "primaryColor", "secondaryColor", "tertiaryColor"]) add(value.colors[k]);
    }
    const styles = value.style;
    if (Array.isArray(styles)) for (const s of styles) if (s) {
      add(s.backgroundColor); add(s.borderColor); add(s.color);
    }
    else if (styles) { add(styles.backgroundColor); add(styles.borderColor); add(styles.color); }

    for (const k of Object.keys(value)) {
      if (/^(role|props|style|colors|rolePill|roleDot|themed)/i.test(k)) {
        out.push(...findColors(value[k], seen, depth + 1));
      }
    }
  }
  return [...new Set(out)];
}

function copyFrom(args: any[], result: any) {
  const colors = [...findColors(args), ...findColors(result)];
  const unique = [...new Set(colors)];
  if (!unique.length) return false;
  clipboard.setString(unique.join(" "));
  try { showToast("Copied role color", getAssetIDByName("ic_message_copy")); } catch (_) { showToast("Copied role color"); }
  return true;
}

function patchCandidate(obj: any, key: string) {
  if (!obj || typeof obj[key] !== "function" || obj[key][MARK]) return false;
  const fn = obj[key];
  let src = "";
  try { src = Function.prototype.toString.call(fn); } catch (_) {}
  if (!/rolePillBackgroundColor|roleDotStyle|useRoleColorSettingValue|RolePill/i.test(src)) return false;

  const un = patcher.after(key, obj, (args: any[], res: any) => {
    if (!res || !res.props || res.props[MARK]) return res;
    Object.defineProperty(res.props, MARK, { value: true, enumerable: false });
    const oldPress = res.props.onPress;
    if (typeof oldPress !== "function") return res;
    res.props.onPress = (...pressArgs: any[]) => {
      if (!copyFrom(args, res)) oldPress(...pressArgs);
    };
    return res;
  });
  unpatches.push(un);
  return true;
}

function scan() {
  if (installed) return;
  const mods = (metro as any).modules;
  const candidates: any[] = [];
  const seen = new Set<any>();

  const walk = (v: any, depth = 0) => {
    if (v == null || depth > 3 || seen.has(v)) return;
    if (typeof v !== "object" && typeof v !== "function") return;
    seen.add(v);
    if (typeof v === "function") {
      let src = ""; try { src = Function.prototype.toString.call(v); } catch (_) {}
      if (/rolePillBackgroundColor|roleDotStyle|useRoleColorSettingValue|RolePill/i.test(src)) candidates.push(v);
      return;
    }
    for (const k of Object.keys(v)) {
      if (/default|render|type|exports|role/i.test(k)) walk(v[k], depth + 1);
    }
  };

  try {
    const list = typeof mods === "object" ? Object.values(mods) : [];
    for (const m of list) walk(m);
  } catch (_) {}

  for (const fn of candidates) {
    try {
      const parent = { target: fn };
      if (patchCandidate(parent, "target")) installed = true;
    } catch (_) {}
  }

  // Also scan the public Metro finder result set. This is narrower and safe.
  try {
    const all = metro.findAll((m: any) => {
      try {
        return Object.values(m || {}).some((v: any) => typeof v === "function" && /rolePillBackgroundColor|roleDotStyle|useRoleColorSettingValue|RolePill/i.test(Function.prototype.toString.call(v)));
      } catch (_) { return false; }
    });
    for (const m of all || []) {
      if (patchCandidate(m, "default")) installed = true;
      if (patchCandidate(m, "render")) installed = true;
    }
  } catch (_) {}
}

export default {
  onLoad: () => {
    // Discord loads many profile modules lazily, so scan more than once.
    scan();
    const timers = [500, 1500, 3000, 6000, 10000].map(ms => setTimeout(scan, ms));
    unpatches.push(() => timers.forEach(clearTimeout));
  },
  onUnload: () => {
    unpatches.splice(0).forEach(u => { try { u(); } catch (_) {} });
    installed = false;
  },
};
