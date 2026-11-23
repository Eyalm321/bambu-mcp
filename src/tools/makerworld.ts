import { z } from "zod";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { checkPath, defaultDir } from "../limits.js";
import { designId, downloadTo, mwJson, summarizeInstance } from "../makerworld.js";

/** A file name MakerWorld suggests, reduced to a safe basename ending in .3mf. */
export function safeName(name: unknown, fallback: string): string {
  const base = basename(String(name ?? "")).replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/^[.\s]+/, "").slice(0, 120);
  const n = base || fallback;
  return /\.3mf$/i.test(n) ? n : `${n}.3mf`;
}

export const makerworldTools = [
  {
    name: "makerworld_search",
    description:
      "Search MakerWorld models by keyword (no login needed). Returns design ids, titles, creators and counts; pass a design id to makerworld_get_design to see its print profiles.",
    inputSchema: z.object({
      keyword: z.string().min(1).describe("Search words, e.g. 'P2S camera privacy cover'"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
    }),
    handler: async (args: { keyword: string; limit?: number }) => {
      const r = await mwJson("/api/v1/search-service/select/design2", { keyword: args.keyword, limit: args.limit ?? 10, offset: 0 });
      return {
        total: r.total,
        designs: (r.hits ?? []).map((h: any) => ({
          designId: h.id,
          title: h.title,
          creator: h.designCreator?.name,
          url: `https://makerworld.com/en/models/${h.id}`,
          printCount: h.printCount,
          downloadCount: h.downloadCount,
          likeCount: h.likeCount,
          license: h.license,
        })),
      };
    },
  },
  {
    name: "makerworld_get_design",
    description:
      "Get a MakerWorld design and its print profiles (no login needed): each profile's instanceId, title, print time, grams, filaments and whether it needs an AMS. Pass the chosen instanceId to makerworld_download.",
    inputSchema: z.object({
      design: z.union([z.string(), z.number()]).describe("Design id or makerworld.com model URL"),
    }),
    handler: async (args: { design: string | number }) => {
      const id = designId(args.design);
      const d = await mwJson(`/api/v1/design-service/design/${id}`);
      return {
        designId: d.id,
        title: d.title,
        creator: d.designCreator?.name,
        license: d.license,
        url: `https://makerworld.com/en/models/${d.id}`,
        defaultInstanceId: d.defaultInstanceId,
        profiles: (d.instances ?? []).map(summarizeInstance),
      };
    },
  },
  {
    name: "makerworld_download",
    description:
      "Download one MakerWorld print profile's 3MF project to this machine (needs the one-time Bambu account login). The file is a project, not sliced G-code: slice it with bambu_slice, then bambu_upload + bambu_print_file. Personal use; one profile per call.",
    inputSchema: z.object({
      instanceId: z.number().int().positive().describe("Print profile id (instanceId from makerworld_get_design)"),
      localPath: z
        .string()
        .optional()
        .describe("Destination .3mf path (default: MakerWorld's file name in the working directory or BAMBU_PATH_ROOT)"),
    }),
    handler: async (args: { instanceId: number; localPath?: string }) => {
      const r = await mwJson(`/api/v1/design-service/instance/${args.instanceId}/f3mf`, { type: "download" }, true);
      if (typeof r?.url !== "string") throw new Error("MakerWorld answered without a file URL");
      const target = args.localPath ?? join(defaultDir(), safeName(r.name, `makerworld-${args.instanceId}`));
      const to = checkPath(target, "write");
      if (existsSync(to)) throw new Error(`Refused: ${target} already exists`);
      const bytes = await downloadTo(r.url, to);
      return { instanceId: args.instanceId, downloaded: to, bytes, name: r.name };
    },
  },
];
