import { z } from "zod";
import { downloadFile, deleteFile } from "../client.js";

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
      await downloadFile(args.remoteName, args.localPath);
      return { downloaded: args.remoteName, to: args.localPath };
    },
  },
  {
    name: "bambu_delete_file",
    description:
      "Delete a file from the printer's FTPS storage. This is permanent.",
    inputSchema: z.object({
      remoteName: z.string().describe("File name/path on the printer to delete"),
    }),
    handler: async (args: { remoteName: string }) => {
      await deleteFile(args.remoteName);
      return { deleted: args.remoteName };
    },
  },
];
