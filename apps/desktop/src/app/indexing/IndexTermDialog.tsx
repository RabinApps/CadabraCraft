import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { termKey, type IndexPlace, type IndexTerm, type IndexTree } from "@cadabracraft/shared";
import { Button } from "../../ui/Button";
import { Confirm, Modal } from "../../ui/Dialog";
import { Field } from "../../ui/forms/Input";
import { Select } from "../../ui/forms/Select";
import { IndexLocations } from "./IndexLocations";
import { termProblemText } from "../../lib/indexing/problemText";
import { termProblem } from "../../lib/indexing/validation";
import { useProject } from "../../state/project/index";
import { attempt } from "../../state/attempt";

interface Props {
  term: IndexTerm | null;
  tree: IndexTree;
  titles: ReadonlyMap<string, string>;
  hidden: boolean;
  onClose: () => void;
  onGo: (place: IndexPlace) => void;
}

/** The editor of one index term: rename it, put it under another, merge it into another, see where it is marked, hide or delete it. */
export function IndexTermDialog(props: Props) {
  const { t } = useLingui();
  return (
    <Modal
      open={props.term !== null}
      onOpenChange={(o) => !o && props.onClose()}
      title={t`Edit index entry`}
      size="wide"
    >
      {props.term && <Form {...props} term={props.term} />}
    </Modal>
  );
}

function Form({ term, tree, titles, hidden, onClose, onGo }: Props & { term: IndexTerm }) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const others = tree.groups
    .flatMap((g) => g.terms.map((x) => x.term))
    .filter((x) => termKey(x) !== termKey(term.term));
  const [name, setName] = useState(term.term);
  const [under, setUnder] = useState("");
  const [into, setInto] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [shown, setShown] = useState(false);
  const places: { place: IndexPlace; sub?: string }[] = [
    ...term.places.map((place) => ({ place })),
    ...term.subs.flatMap((s) => s.places.map((place) => ({ place, sub: s.term }))),
  ];
  const problem = termProblem(name);
  const done = (p: Promise<unknown>) => {
    attempt(p);
    onClose();
  };
  const rename = (e: React.FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (problem || (termKey(name) === termKey(term.term) && name.trim() === term.term)) return;
    done(actions.renameIndexTerm(term.term, name));
  };
  return (
    <div className="flex flex-col gap-5">
      <form className="flex items-end gap-2" onSubmit={rename}>
        <div className="min-w-0 flex-1">
          <Field
            label={t`Term`}
            value={name}
            autoFocus
            error={shown && problem ? termProblemText(problem) : undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button type="submit">{t`Rename`}</Button>
      </form>
      {others.length > 0 && (
        <>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Select
                label={t`Move under`}
                value={under}
                onChange={(e) => setUnder(e.target.value)}
              >
                <option value="">{t`Choose a term`}</option>
                {others.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </div>
            <Button disabled={!under} onClick={() => done(actions.moveIndexTerm(term.term, under))}>
              {t`Move`}
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Select
                label={t`Merge into another term`}
                value={into}
                onChange={(e) => setInto(e.target.value)}
              >
                <option value="">{t`Choose a term`}</option>
                {others.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </div>
            <Button disabled={!into} onClick={() => done(actions.renameIndexTerm(term.term, into))}>
              {t`Merge`}
            </Button>
          </div>
        </>
      )}
      <IndexLocations places={places} titles={titles} onGo={onGo} onClose={onClose} />
      <div className="flex flex-wrap justify-between gap-2.5">
        <div className="flex gap-2">
          <Button variant="danger" onClick={() => setConfirm(true)}>
            {t`Delete term`}
          </Button>
          <Button onClick={() => done(actions.setIndexTermHidden(term.term, !hidden))}>
            {hidden ? t`Show in the book's index` : t`Leave out of the book's index`}
          </Button>
        </div>
        <Button onClick={onClose}>{t`Close`}</Button>
      </div>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={t`Delete this term?`}
        description={t`Every place marked with “${term.term}” leaves the index. The words stay in your pages. You can undo this with Undo book change.`}
        confirmLabel={t`Delete term`}
        onConfirm={() => done(actions.deleteIndexTerm(term.term))}
      />
    </div>
  );
}
