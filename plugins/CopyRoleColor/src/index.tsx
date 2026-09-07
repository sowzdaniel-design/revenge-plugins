import { patcher } from "@vendetta";
import * as metro from "@vendetta/metro";
import { findInReactTree } from "@vendetta/utils";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

const unpatches: (() => void)[] = [];
const patched = new Set<any>();

const hex = (v: any): string | null => {
    if (typeof v === "number" && Number.isFinite(v)) return `#${(v & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
    if (typeof v !== "string") return null;
    const m = v.trim().match(/^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
    return m ? `#${m[1].toUpperCase()}` : null;
};
function push(out: string[], v: any) { const h = hex(v); if (h && !out.includes(h)) out.push(h); }
function gradients(out: string[], v: any) { if (typeof v !== "string") return; for (const m of v.match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?/gi) || []) push(out, m); }
function inspect(x: any, out: string[], depth = 0, seen = new Set<any>()) {
    if (!x || depth > 7 || (typeof x !== "object" && typeof x !== "function") || seen.has(x)) return;
    seen.add(x); const p = x.props || x;
    const role = p.role || p.roleData || p.guildRole || p.guild_role || p.guildRoleData;
    const colors = p.colors || role?.colors || role?.color_data || role?.colorData;
    if (colors) { push(out, colors.primary_color); push(out, colors.secondary_color); push(out, colors.tertiary_color); push(out, colors.primaryColor); push(out, colors.secondaryColor); push(out, colors.tertiaryColor); }
    for (const k of ["color","roleColor","primary_color","secondary_color","tertiary_color","primaryColor","secondaryColor","tertiaryColor","backgroundColor"]) push(out, role?.[k] ?? p[k]);
    for (const k of ["backgroundImage","backgroundGradient","gradient","roleColor","backgroundColor"]) gradients(out, role?.[k] ?? p[k]);
    const styles = Array.isArray(p.style) ? p.style : [p.style];
    for (const s of styles) { if (!s) continue; push(out, s.backgroundColor); push(out, s.color); gradients(out, s.backgroundColor); gradients(out, s.backgroundImage); }
    if (p.children) { const children = Array.isArray(p.children) ? p.children : [p.children]; for (const c of children) inspect(c, out, depth + 1, seen); }
}
function getColors(args: any[], result: any) { const out: string[] = []; inspect(result, out); for (const a of args || []) inspect(a, out); return out.slice(0, 3); }
function patchTree(result: any, args: any[]) {
    if (!result) return; const colors = getColors(args, result); if (!colors.length) return;
    const pressable = findInReactTree(result, (m: any) => { const p = m?.props; return !!p && typeof p.onPress === "function" && (p.onLongPress == null || typeof p.onLongPress === "function"); });
    const target = pressable || result; if (!target?.props) return;
    // Normal tap = copy the role color(s). Keep Discord's existing onLongPress
    // handler untouched so a long press continues to perform Discord's normal
    // role-ID copy action.
    const copyColors = () => { clipboard.setString(colors.join(" ")); showToast(colors.length > 1 ? `Copied ${colors.length} role colors` : "Copied role color to clipboard", getAssetIDByName("ic_message_copy")); };
    target.props.onPress = copyColors;
}
function patchCandidate(mod: any) {
    if (!mod || patched.has(mod)) return;
    const fn = typeof mod === "function" ? mod : typeof mod.default === "function" ? mod.default : typeof mod.default?.default === "function" ? mod.default.default : null;
    if (!fn) return; patched.add(mod);
    try { unpatches.push(patcher.after("default", mod, (args: any[], res: any) => patchTree(res, args))); return; } catch {}
    try { unpatches.push(patcher.after("default", { default: fn }, (args: any[], res: any) => patchTree(res, args))); } catch {}
}
function discover() {
    const candidates: any[] = []; const names = ["RolePill", "RolePillComponent", "ThemedRolePill"];
    for (const name of names) for (const def of [false, true]) {
        try { candidates.push((metro as any).findByName(name, def)); } catch {}
        try { candidates.push((metro as any).findByDisplayName(name, def)); } catch {}
        try { candidates.push((metro as any).findByTypeName(name, def)); } catch {}
    }
    try {
        const all = (metro as any).findAll((m: any) => [m, m?.default, m?.default?.default].filter(Boolean).some((v: any) => /role.?pill/i.test(String(v?.displayName || v?.name || v?.type?.name || v?.render?.name || ""))));
        if (Array.isArray(all)) candidates.push(...all);
    } catch {}
    for (const c of candidates) patchCandidate(c);
}
export default {
    onLoad: () => { discover(); const timer = setInterval(discover, 2000); unpatches.push(() => clearInterval(timer)); },
    onUnload: () => { for (const u of unpatches.splice(0)) try { u(); } catch {} patched.clear(); },
};
