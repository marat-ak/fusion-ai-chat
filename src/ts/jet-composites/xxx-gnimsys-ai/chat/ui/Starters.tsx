import "oj-c/button";
import { Banner } from "./Banner";
import { AGENT_INDENT, AgentRow } from "./Bubble";

/** Suggested questions as outlined buttons, wrapping onto as many lines as they need. */
export function QuestionButtons(props: { testId: string; class: string; questions: string[]; disabled: boolean; onPick: (question: string) => void }) {
  if (props.questions.length === 0) return null;
  return (
    <div class={`oj-flex ${props.class}`}>
      {props.questions.map((q, i) => (
        <oj-c-button key={i + ":" + q} class="oj-sm-margin-2x-end oj-sm-margin-2x-bottom" data-testid={props.testId}
          chroming="outlined" label={q} disabled={props.disabled} onojAction={() => props.onPick(q)} />
      ))}
    </div>
  );
}

/**
 * The agent's greeting on an empty conversation: a bubble with the greeting text and the starter questions stacked
 * under it as outlined buttons. It shows with or without starters.
 */
export function Greeting(props: { text: string; questions: string[]; disabled: boolean; onPick: (question: string) => void }) {
  return (
    <AgentRow>
      <div class="gai-greeting oj-bg-neutral-0 oj-sm-padding-3x-vertical oj-sm-padding-4x-horizontal oj-helper-overflow-wrap-anywhere"
        data-testid="gai-greeting">
        <div data-testid="gai-greeting-text">{props.text}</div>
        {props.questions.length > 0 && (
          <div class="oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap oj-sm-align-items-flex-start">
            {props.questions.map((q, i) => (
              <oj-c-button key={i + ":" + q} class="oj-sm-margin-2x-top" data-testid="gai-starter" chroming="outlined" label={q}
                disabled={props.disabled} onojAction={() => props.onPick(q)} />
            ))}
          </div>
        )}
      </div>
    </AgentRow>
  );
}

/** Shown under the greeting when the workflow lookup failed (auth failures use the auth banner instead). */
export function StartersUnavailable(props: { error: { message: string; status?: number } }) {
  const why = props.error.status ? "HTTP " + props.error.status : props.error.message;
  return <Banner testId="gai-workflow-error" severity="warning" class={AGENT_INDENT} summary={`Starter questions unavailable (${why})`} />;
}
