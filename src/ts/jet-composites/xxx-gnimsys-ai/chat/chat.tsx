import { ExtendGlobalProps, registerCustomElement } from "ojs/ojvcomponent";
import { ComponentProps, ComponentType } from "preact";
import componentStrings = require("ojL10n!./resources/nls/chat-strings");
import "css!xxx-gnimsys-ai/chat/chat-styles.css";

type Props = Readonly<{
  config?: object | string;
  userName?: string;
  personId?: string;
  context?: Record<string, unknown>;
  conversationId?: string;
}>;

/**
 * @ojmetadata pack "xxx-gnimsys-ai"
 * @ojmetadata version "0.1.0"
 * @ojmetadata displayName "A user friendly, translatable name of the component"
 * @ojmetadata description "A translatable high-level description for the component"
 * 
 */
function ChatImpl(props: Props) {
  return <div class="gai-chat">needs-input</div>;
}

export const Chat: ComponentType <
  ExtendGlobalProps < ComponentProps < typeof ChatImpl>>
> = registerCustomElement(
    "xxx-gnimsys-ai-chat",
  ChatImpl
);
