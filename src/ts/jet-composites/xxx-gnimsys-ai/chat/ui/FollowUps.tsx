import { AGENT_INDENT } from "./Bubble";
import { QuestionButtons } from "./Starters";

/** Follow-up questions under the last reply, aligned with the agent's bubbles. */
export function FollowUps(props: { questions: string[]; disabled: boolean; onPick: (question: string) => void }) {
  return <QuestionButtons testId="gai-followup" class={AGENT_INDENT} {...props} />;
}
