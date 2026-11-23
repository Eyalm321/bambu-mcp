import { z } from "zod";
import { downloadFile, deleteFile } from "../client.js";
import { checkDeleteName, checkPath } from "../limits.js";

export const fileTools = [
  {
    name: "bambu_download_file",
    description:
      "Download a file from the printer's FTPS storage to this machine.",
    inputSchema: z.object({
      remoteName: z.string().describe("File name/path on the printer"),
      localPath: z.string().describe("Destination path on this machine"),
    }),
    handler: async (args: { remoteName: string; localPath: string }) => {
      const to = checkPath(args.localPath, "write");
      await downloadFile(args.remoteName, to);
      return { downloaded: args.remoteName, to };
    },
  },
  {
    name: "bambu_delete_file",
    description:
      "Delete a file from the printer's FTPS storage. This is permanent. Where BAMBU_DELETE_PREFIX is set, only a top-level file whose name starts with it can be deleted.",
    inputSchema: z.object({
      remoteName: z.string().describe("File name/path on the printer to delete"),
    }),
    handler: async (args: { remoteName: string }) => {
      await deleteFile(checkDeleteName(args.remoteName));
      return { deleted: args.remoteName };
    },
  },
];
