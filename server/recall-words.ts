/** Words that say nothing about what a search is for, in the languages people write to their bots in. */
export const STOP_WORDS = new Set([
  ..."a an and are as at be by did do for from had has have how i in is it its of on or that the this to was we were what when where which who why with you your".split(" "),
  ..."le la les un une des du de au aux et ou mais donc ni que qui quoi dont où ce cet cette ces se sa ses mon ma mes ta tes notre nos votre vos leur leurs je tu il elle on nous vous ils elles me te lui ne pas plus est sont suis être été ai avons avez ont pour par avec sans sur sous dans entre vers chez comme si très tout tous toute toutes aussi alors ça cela ceci".split(" "),
  ..."el los las una unos unas del al pero quien qué cuál cómo dónde cuándo para por con sin sobre es está están mi mis tus su sus lo nos muy más".split(" "),
  ..."os as um uma do da dos das na nas em é são eu você meu minha seu sua não".split(" "),
  ..."der die das dem ein eine einen und oder aber ist sind ich du er sie es wir ihr mit für auf im zu von bei nicht wie wo wann warum".split(" "),
  ..."il lo gli di della che per è sono io mio mia".split(" "),
]);

/** Greetings and "do you remember" phrasing, which a recall query drops on top of the small words. */
export const RECALL_FILLER = new Set([
  ..."about again also any anything can could does don't know me my please remember remind should tell there they us would hi hello hey thanks thank ok okay yes yeah no i'm im i've i'll i'd you're quick just".split(" "),
  ..."bonjour salut coucou merci stp svp peux pourrais peut veux voudrais rappelle rappelles rappeler souviens souvenir dis dire sais savoir oui non d'accord encore quel quelle quels quelles comment pourquoi quand fais faire faut".split(" "),
  ..."hola gracias puedes recuerdas recuerda olá obrigado obrigada lembra hallo danke bitte erinnerst ciao grazie ricordi".split(" "),
]);

/** Drops a plural "s" and a final "e" so "factures", "facture" and "facturation" (or "prices" and "pricing") meet. */
export function recallStem(term: string): string {
  const single = term.length > 4 && term.endsWith("s") && !term.endsWith("ss") ? term.slice(0, -1) : term;
  return single.length > 5 && single.endsWith("e") && !single.endsWith("ee") ? single.slice(0, -1) : single;
}

/** "l'équipe", "d'Abidjan", "qu'elle": the word after a French elision. */
export const ELISION = /^(?:l|d|j|m|t|s|c|n|qu|jusqu|lorsqu|puisqu)['’](?=\p{L})/iu;
