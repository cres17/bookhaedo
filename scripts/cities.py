import osmium,json
names={'札幌市':('삿포로','sapporo',-15,28),'小樽市':('오타루','otaru',-20,-18),'旭川市':('아사히카와','asahikawa-biei',20,-15),'美瑛町':('비에이','asahikawa-biei',30,4),'富良野市':('후라노','furano',18,30),'函館市':('하코다테','hakodate',20,22),'登別市':('노보리베츠','toya-noboribetsu',25,35),'ニセコ町':('니세코','niseko-kutchan',-25,24),'釧路市':('구시로','kushiro-akan',18,22),'網走市':('아바시리','abashiri-shiretoko',20,-12),'帯広市':('오비히로','obihiro-tokachi',15,28),'稚内市':('왓카나이','wakkanai-rishiri-rebun',20,-12)}
class Cities(osmium.SimpleHandler):
 def __init__(self): super().__init__();self.data={}
 def node(self,n):
  name=n.tags.get('name')
  if name in names and n.tags.get('place') in ('city','town','village'):
   label,region,dx,dy=names[name];self.data[name]={'name':label,'ja':name,'region':region,'latitude':n.location.lat,'longitude':n.location.lon,'dx':dx,'dy':dy,'source':'https://www.openstreetmap.org/node/'+str(n.id)}
h=Cities();h.apply_file('hokkaido-260907.osm.pbf')
if len(h.data)<10: raise RuntimeError('Missing cities: '+str(set(names)-set(h.data)))
with open('frontend/public/hokkaido-cities.json','w') as f:json.dump(list(h.data.values()),f,ensure_ascii=False)
print('Verified OSM city points:',len(h.data))
