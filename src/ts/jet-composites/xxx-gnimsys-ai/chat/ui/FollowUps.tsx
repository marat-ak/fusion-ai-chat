export function FollowUps(props: { questions: string[]; disabled: boolean; onPick: (question: string) => void }) {
  if (props.questions.length === 0) return null;
  return (
    <div class="gai-chips gai-followups">
      {props.questions.map((q, i) => (
        <button type="button" key={i + ":" + q} class="gai-chip gai-chip--followup" data-testid="gai-followup"
          disabled={props.disabled} onClick={() => props.onPick(q)}>
          {q}
        </button>
      ))}
    </div>
  );
}
