import { Editor } from "./Editor";
import { getContent } from "./functions";
import { RouteOptions } from "@redwoodjs/sdk/router";

const Note = async (ctx: RouteOptions) => {
  const key = ctx.params.key;
  const content = await getContent(key, ctx);
  return <Editor props={{ initialContent: content, key }} />;
};

export default Note;
