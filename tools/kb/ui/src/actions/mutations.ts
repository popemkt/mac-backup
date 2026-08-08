/**
 * Mutation action layer — U3 wires these to optimistic tx + POST /api/action.
 * U2 leaves them throwing so call sites stay discoverable without silent no-ops.
 */
function notWired(name: string): never {
  throw new Error(`not wired: ${name}`);
}

export const mutations = {
  updateNodeContent: (_id: string, _content: string): never =>
    notWired("updateNodeContent"),
  createNodeAfter: (_afterId: string): never => notWired("createNodeAfter"),
  deleteNode: (_id: string): never => notWired("deleteNode"),
  indentNode: (_id: string): never => notWired("indentNode"),
  outdentNode: (_id: string): never => notWired("outdentNode"),
  moveNodeUp: (_id: string): never => notWired("moveNodeUp"),
  moveNodeDown: (_id: string): never => notWired("moveNodeDown"),
  updateProp: (
    _nodeId: string,
    _fieldId: string,
    _value: unknown,
  ): never => notWired("updateProp"),
  addTag: (_nodeId: string, _tagId: string): never => notWired("addTag"),
  removeTag: (_nodeId: string, _tagId: string): never => notWired("removeTag"),
};

export type Mutations = typeof mutations;
