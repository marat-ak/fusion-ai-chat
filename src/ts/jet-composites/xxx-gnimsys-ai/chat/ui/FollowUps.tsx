import { QuestionButtons } from "./Starters";

export function FollowUps(props: { questions: string[]; disabled: boolean; onPick: (question: string) => void }) {
  return <QuestionButtons testId="gai-followup" class="" {...props} />;
}
