#!/usr/bin/env python
#coding:utf-8

import os
import json
from collections import defaultdict
import queue
import graphviz

HERE = os.path.dirname(os.path.abspath(__file__))
package_dir = os.path.join(HERE, "packages")



def main():
    ff = os.listdir(package_dir)
    d = defaultdict(set)
    for f in ff:
        if f == "metapackage":
            continue
        json_file = os.path.join(package_dir, f, "package.json")
        with open(json_file) as fp:
            data = json.loads(fp.read())
        deps = list(data['dependencies'].keys())
        tt = []
        for i in deps:
            if i.startswith("@jupyterlab"):
                b = i.replace("@jupyterlab/", "")
                d[f].add(b)  # f depend b
           # else:
           #     tt.append(i)
    for k in ff:
        # if len(d[k]) <= # and ",".join(d[k]) == "metapackage":
        #    print(k)
        print("%02d" % len(d[k]), k, ",".join(d[k]))
    print(os.environ['PATH'])

    for f in ff:
        if not f.endswith("-extension"):
            continue
        dot = graphviz.Digraph(name=f, comment='package dev')
        q = queue.Queue()
        q.put(f)
        edge_set = set()
        out_node_set = set()
        while not q.empty():
            e = q.get()
            for i in d[e]:
                edge_e = (e, i)
                if edge_e not in edge_set and i not in out_node_set:
                    dot.edge(e, i)
                    edge_set.add(edge_e)
                    out_node_set.add(i)
                q.put(i)
        dot.view(filename=f)
        print("finish %s" % f)

def search(k):
    ff = os.listdir(package_dir)
    for f in ff:
        if f == "metapackage":
            continue
        json_file = os.path.join(package_dir, f, "package.json")
        with open(json_file) as fp:
            data = json.loads(fp.read())
        deps = list(data['dependencies'].keys())
        for dep in deps:
            if k in dep:
                print(f)
                break



if __name__ == "__main__":
    # main()
    # search('blueprint')
    search('ui-com')
