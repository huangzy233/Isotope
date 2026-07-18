import { createFsSqliteWorkspace, type WorkspaceStore } from "@isotope/workspace";
import { dataRoot, templatePath } from "./paths";

let store: WorkspaceStore | null = null;

export function getWorkspace(): WorkspaceStore {
  if (!store) {
    store = createFsSqliteWorkspace({
      dataRoot: dataRoot(),
      templatePath: templatePath(),
    });
  }
  return store;
}
