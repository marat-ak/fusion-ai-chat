export function Starters(props: { questions: string[]; disabled: boolean; onPick: (question: string) => void }) {
  if (props.questions.length === 0) return null;
  return (
    <div class="gai-chips gai-starters">
      {props.questions.map((q, i) => (
        <button type="button" key={i + ":" + q} class="gai-chip gai-chip--starter" data-testid="gai-starter"
          disabled={props.disabled} onClick={() => props.onPick(q)}>
          {q}
        </button>
      ))}
    </div>
  );
}

/** Shown where the starters would be when the workflow lookup failed (auth failures use the auth banner instead). */
export function StartersUnavailable(props: { error: { message: string; status?: number } }) {
  const why = props.error.status ? "HTTP " + props.error.status : props.error.message;
  return (
    <div class="gai-workflow-error" data-testid="gai-workflow-error" role="status">
      Starter questions unavailable ({why})
    </div>
  );
}
