import { patcher } from "@vendetta";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";

const unpatches: (() => void)[] = [];
const patched = new WeakSet<Function>();

function hex(n: unknown) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6).toUpperCase();
}

function color(v: unknown) {
  if (typeof v === "number") return hex(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^#[0-9a-f]{6,8}$/i.test(s) ? s.slice(0, 7).toUpperCase() : null;
}

function getRoleColors(x: any): string[] {
  if (!x || typeof x !== "object") return [];
  const out: string[] = [];
  const add = (v: unknown) => {
    const c = color(v);
    if (c && !out.includes(c)) out.push(c);
  };

  // Discord 333.12 role objects use colors.primary_color / secondary_color / tertiary_color.
  const candidates = [x, x.role, x.colors, x.role?.colors, x.props, x.props?.role, x.props?.role?.colors];
  for (const o of candidates) {
    if (!o || typeof o !== "object") continue;
    add(o.primary_color);
    add(o.secondary_color);
    add(o.tertiary_color);
    add(o.primaryColor);
    add(o.secondaryColor);
    add(o.tertiaryColor);
    add(o.roleColor);
    add(o.role_color);
  }
  return out;
}

function patchReturnedElement(node: any, colors: string[]): any {
  if (!node || typeof node !== "object" || !colors.length) return node;

  // Only modify the actual pressable returned by the RolePill component.
  if (node.props && typeof node.props === "object") {
    const p = node.props;
    const roleColors = getRoleColors(p);
    const all = roleColors.length ? roleColors : colors;

    if (p.onPress && all.length) {
      const copy = { ...p };
      const original = p.onPress;
      copy.onPress = (...args: any[]) => {
        const latest = getRoleColors(copy).length ? getRoleColors(copy) : all;
        clipboard.setString(latest.join(" "));
        showToast("Copied role color" + (latest.length > 1 ? "s" : ""), getAssetIDByName("ic_message_copy"));
      };
      // Deliberately do not touch onLongPress.
      return { ...node, props: copy };
    }
  }

  return node;
}

function functionSource(fn: Function) {
  try { return Function.prototype.toString.call(fn); } catch { return ""; }
}

function patchRolePillModule(mod: any) {
  if (!mod || typeof mod !== "object") return;

  for (const [key, value] of Object.entries(mod)) {
    if (typeof value !== "function" || patched.has(value as Function)) continue;

    const src = functionSource(value as Function);
    // These identifiers come from Discord 333.12's actual RolePill implementation.
    if (!/rolePillBackgroundColor|roleDotStyle|useRoleColorSettingValue/.test(src)) continue;

    try {
      patched.add(value as Function);
      unpatches.push(patcher.after(key, mod, (_args: any[], result: any) => {
        try {
          const args = _args?.[0];
          const colors = getRoleColors(args);
          return patchReturnedElement(result, colors);
        } catch {
          return result;
        }
      }));
    } catch {
      // If Discord exposes the function through a frozen/nonstandard export, do nothing.
      // Never patch globally and never risk crashing the client.
    }
  }
}

function scan() {
  try {
    const metro: any = (globalThis as any).vendetta?.metro;
    if (!metro) return;

    // findAll is used only to locate modules containing the actual RolePill implementation.
    const found = metro.findAll((m: any) => {
      try {
        if (!m || typeof m !== "object") return false;
        for (const v of Object.values(m)) {
          if (typeof v === "function" && /rolePillBackgroundColor|roleDotStyle|useRoleColorSettingValue/.test(functionSource(v))) return true;
        }
        return false;
      } catch { return false; }
    });

    for (const m of found || []) {
      patchRolePillModule(m);
      patchRolePillModule(m?.exports);
      patchRolePillModule(m?.publicModule?.exports);
    }
  } catch {
    // Completely fail closed.
  }
}

export default {
  onLoad: () => {
    scan();
    // Discord can lazy-load the profile module, so rescan without touching React globally.
    const timer = setInterval(scan, 1500);
    unpatches.push(() => clearInterval(timer));
  },
  onUnload: () => {
    while (unpatches.length) {
      try { unpatches.pop()?.(); } catch {}
    }
  },
};
