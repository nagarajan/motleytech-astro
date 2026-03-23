---
title: "Importing ipython notebook into another notebook"
pubDate: 2014-08-29
category: "Blog"
tags: ["Computing", "Ipython", "Python", "import"]
author: "Nagarajan"
description: ""
legacySlug: "importing-ipython-notebook"
disqusIdentifier: "cmsplugin-disqus-96"
---
Like me, you probably love ipython notebook and can't get enough of it. However, there is one thing that I found lacking - the support for an integrated way to import a notebook as a module into another notebook.

I did come across the `--script` option (now deprecated), but it creates additional files and I was wondering if there was another way to directly import from the notebook. ( The existence of the `--script` option does make this effort a bit redundant, but I was curious and also learnt some very interesting things on the way. I have shared those too, so do read on... )

What better way to use python knowledge and ipython notebook's rapid development environment to explore options.

To this end, I came up with this custom notebook importer...  (*The scripts on this page are also available here...* [github link](https://github.com/motleytech/pybook/tree/master/.ipython/profile_default/startup) )...

```
import os
import imp
import sys
import io
from IPython.nbformat import current
from traceback import print_exc

def import_notebook(nbname, loader=None):
    fullpath = "{}/{}.ipynb".format(os.getcwd(), nbname)

    if not os.path.exists(fullpath):
        raise Exception("Failed to find ipython notebook: {}.ipynb".format(nbname))

    if nbname in sys.modules:
        mod = sys.modules[nbname]
        return mod

    moduleName = nbname
    nbFilename = nbname + ".ipynb"

    print "Importing ipynb file : {}".format(nbFilename)

    with io.open(nbFilename) as f:
        nb = current.read(f, 'json')

    newModule = imp.new_module(moduleName)

    try:
        for cell in nb.worksheets[0].cells:
            if cell.cell_type != 'code':
                continue
            exec cell.input in newModule.__dict__
    except:
        print "Error in importing ipython notebook."
        print_exc()
        raise

    # Set a few properties required by PEP 302
    newModule.__file__ = nbname
    newModule.__name__ = nbname
    newModule.__path__ = [ nbname ]
    newModule.__loader__ = loader
    newModule.__package__ = '' # no package

    sys.modules[moduleName] = newModule
    return newModule


class IpynbImportFinder(object):
    def __init__(self):
        return

    def find_module(self, modname, path=None):
        modpath = "{}/{}.ipynb".format(os.getcwd(), modname)
        if os.path.exists(modpath):
            return IpynbImportLoader()
        return None


class IpynbImportLoader(object):
    def __init__(self):
        return

    def load_module(self, modname):
        return import_notebook(modname, self)


# Install our custom importer
sys.meta_path.append(IpynbImportFinder())

```

Executing the above code will install an import hook which allows us to directly import ipython notebooks with the `import` statement. It does not require the existence of the corresponding `.py` file.


```

# import the my_notebook.ipynb
import my_notebook as mynb

# import "my nb with spaces.ipynb"
mynb_ws = __import__('my nb with spaces')

```

Note that there is no `.ipynb` extension in the import statements.


One more cool thing related to using import. You can also use the well known `if __name__ == '__main__':` blocks in your notebook for code that you do not want to import into other notebooks, say, test code or long running simulations or whatever you wish.

### Enabling import hooks at startup

Ok, this is great so far... now we can import directly from other notebooks. However, it seems that we will need to add the above script to the top of each notebook that wants to import other notebooks.

If that was the case, this is a disaster. Thankfully, ipython has another gem of a feature. It allows us to specify arbitrary python scripts which get executed by every kernel at startup time.

To make use of the startup script feature, create a file called `~/.ipython/profile_default/startup/10-notebook-import-hook.py` with all the contents of the above import code.


> Why have I started the name of the script with `10-`? Ipython allows us to specify more than 1 startup file. We can specify as many as we want... the prefix `10` is just a way for specifying the order in which the startup scripts will be executed. If you ever want to add more startup scripts at a later time and they need to have some order of execution enforced on them... the numbering is the way to do it. A script with the name `3_wake_up.py` will be executed before `5_drink_tea.py`.


Restart your notebook kernel and you should now be able to directly import other notebooks using `import` and `__import__`.


## Adding useful customization at startup

I like to have some other useful things available in every ipython notebook. Like the `pprint` function (abbreviated to `pp`), and my own version of `timeit`.

I added these to the startup process, where these are inserted into the globals, so that they are available in every ipython notebook.

```
from time import time
from pprint import pprint as pp

def timeit(func):
    def wrapper(*a, **kw):
        startTime = time()
        try:
            rv = func(*a, **kw)
        except:
            raise
        finally:
            endTime = time()
            print "Time = {etime}".format(etime=(endTime - startTime))
        return rv
    return wrapper

gl = globals()
gl['pp'] = pp
gl['timeit'] = timeit

```

ps: The import_notebook method has originally been derived from `http://nbviewer.ipython.org/gist/minrk/5491090/analysis.ipynb`
