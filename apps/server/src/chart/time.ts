/** Local clock formatting shared by the chart rules and the bag prompts. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const pad = (n: number) => String(n).padStart(2, '0')
/** Local `HH:MM`, from getHours/getMinutes so no ICU build can vary it. */
const hhmm = (t: number) => {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** Local midnight of `t`'s date. */
export const localDate = (t: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
/** `HH:MM`, prefixed `D Mon` when not on `now`'s local date. */
export const when = (t: number, now: number) => {
  const d = new Date(t)
  return localDate(t) === localDate(now) ? hhmm(t) : `${d.getDate()} ${MONTHS[d.getMonth()]} ${hhmm(t)}`
}
