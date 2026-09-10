"""Export actual OSM Hokkaido boundary as a lightweight SVG path for the landing map."""
import json
from pathlib import Path
import osmium
from shapely import wkb
class Boundary(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.result = None
        self.factory = osmium.geom.WKBFactory()
    def area(self, a):
        if a.tags.get('boundary') == 'administrative' and a.tags.get('name') == '北海道':
            self.result = wkb.loads(self.factory.create_multipolygon(a), hex=True)
h = Boundary()
h.apply_file('hokkaido-260907.osm.pbf', locations=True, idx='flex_mem')
if h.result is None:
    raise RuntimeError('Hokkaido boundary missing')
g = h.result.simplify(.009, preserve_topology=True)
# Use a fixed lat/lon projection also used by frontend regional markers.
paths = []
for polygon in (g.geoms if hasattr(g,'geoms') else [g]):
    if polygon.area < .008: continue
    points = [((lon-139)*102, (46-lat)*140) for lon,lat in polygon.exterior.coords]
    paths.append('M'+' L'.join(f'{x:.1f},{y:.1f}' for x,y in points)+' Z')
dest=Path('frontend/public/hokkaido-outline.json');dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_text(json.dumps({'path':' '.join(paths),'source':'© OpenStreetMap contributors','license':'ODbL 1.0'}))
print('Hokkaido outline exported',len(paths),'polygons')
