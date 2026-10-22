import "oj-c/button";
import { Banner } from "./Banner";

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

export function Starters(props: { questions: string[]; disabled: boolean; onPick: (question: string) => void }) {
  return <QuestionButtons testId="gai-starter" class="gai-push-down" {...props} />;
}

/** Shown where the starters would be when the workflow lookup failed (auth failures use the auth banner instead). */
export function StartersUnavailable(props: { error: { message: string; status?: number } }) {
  const why = props.error.status ? "HTTP " + props.error.status : props.error.message;
  return <Banner testId="gai-workflow-error" severity="warning" class="gai-push-down" summary={`Starter questions unavailable (${why})`} />;
}
