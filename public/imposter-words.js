// Imposter word lists. One source for both modes:
// imposter.html imports it for the one-phone game, and the server (worker/games/imposter.js)
// imports the same file to pick the word for online rooms, so the word never reaches an imposter's phone.
export const WORDS = {
  'Ushqime': ['byrek','fërgesë','tavë kosi','bakllava','qofte','flija','japrak','tarator','petulla','trileçe','kadaif','sufllaqe','pica','makarona','supë','patate të skuqura','shalqi','pite me spinaq'],
  'Vende': ['Sarandë','Ksamil','Berat','Gjirokastër','Durrës','Theth','Valbonë','Shkodër','Korçë','Vlorë','Himarë','Pogradec','Krujë','Dhërmi','Butrint','Tiranë','Përmet','Prishtinë'],
  'Në shtëpi': ['frigorifer','divan','televizor','perde','jastëk','fshesë','lavatriçe','sobë','dritare','pasqyrë','telekomandë','ballkon','çelës','krevat','furrë','llambë'],
  'Profesione': ['mjek','mësues','polic','berber','kamarier','shofer taksie','inxhinier','avokat','kuzhinier','futbollist','elektricist','hidraulik','farmacist','gazetar','pilot','dentist'],
  'Kafene': ['espresso','makiato','kapuçino','çaj mali','dhallë','boza','lëng portokalli','kroasan','filxhan','sheqer','kamarier','gazetë','tavëll','letra','fatura','akullore'],
  'Sport': ['futboll','basketboll','tenis','not','boks','volejboll','çiklizëm','shah','mundje','vrapim','ski','hendboll'],
  'Kafshë': ['qen','mace','ujk','ari','shqiponjë','dele','dhi','kalë','gomar','lepur','breshkë','delfin','peshkaqen','bletë','gjel','lopë']
};
export const CATS = Object.keys(WORDS);
export const TIMES = [0, 60, 120, 180, 300];
