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
