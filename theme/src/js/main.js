import {initEngagement} from "./engagement.js";
import {initRichContent} from "./rich-content.js";
import {createRuntimeContext} from "./runtime.js";
import {initSite} from "./site.js";

var context = createRuntimeContext();
initSite(context);
initEngagement(context);
initRichContent(context);
