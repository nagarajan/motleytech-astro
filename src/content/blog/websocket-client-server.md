---
title: "Python websocket server and JS client"
pubDate: 2014-09-04
category: "Blog"
tags: ["Computing", "Python", "JS", "Websocket"]
author: "Nagarajan"
description: ""
legacySlug: "websocket-client-server"
disqusIdentifier: "python-websocket-client-server"
---
Recently, I got down to writing a very simple python websocket server and JS web client. There are various solutions out there to get this done, but `websocket_server` is one of the simplest. Its pip installable and has a single source code file, which you can modify to your liking.

Here is a simple python websocket server and JS client to get things started...

---

### Install the websocket_server library

I like to work with `virtualenv` and if you have still not started using it, I highly suggest you give it a try. Steps to install virtualenv on ubuntu...

```
sudo apt-get install python-setuptools
sudo easy_install pip
sudo pip install -U pip
sudo pip install virtualenv
```

Once you have virtualenv, you can run the following to install the requirements...

```
mkdir -p ~/dev/wsServer
cd ~/dev/wsServer
virtualenv venv
source venv/bin/activate
pip install websocket_server
```

These commands will create a virtualenv environment and install the `websocket_server` library in it.

Now, we are ready to create our websocket based chat server.


### Websocket server in python

In the `~/dev/wsServer` folder, create a `server.py` file and paste the following contents in it...

```
from websocket_server import WebsocketServer

clients = {}

def client_left(client, server):
    msg = "Client (%s) left" % client['id']
    print msg
    try:
        clients.pop(client['id'])
    except:
        print "Error in removing client %s" % client['id']
    for cl in clients.values():
        server.send_message(cl, msg)


def new_client(client, server):
    msg = "New client (%s) connected" % client['id']
    print msg
    for cl in clients.values():
        server.send_message(cl, msg)
    clients[client['id']] = client


def msg_received(client, server, msg):
    msg = "Client (%s) : %s" % (client['id'], msg)
    print msg
    clientid = client['id']
    for cl in clients:
        if cl != clientid:
            cl = clients[cl]
            server.send_message(cl, msg)

server = WebsocketServer(9001)
server.set_fn_client_left(client_left)
server.set_fn_new_client(new_client)
server.set_fn_message_received(msg_received)
server.run_forever()

```

That's all there is to our websocket server!!

### Javascript websocket client

Create a `client.html` file in `~/dev/wsServer` folder and paste in the following contents (derived from a stackoverflow answer)...

```
<html>
<head>
  <title>Simple client</title>

  <script type="text/javascript">

    var ws;

    function init() {

      // Connect to Web Socket
      ws = new WebSocket("ws://localhost:9001/");

      // Set event handlers.
      ws.onopen = function() {
        output("onopen");
      };

      ws.onmessage = function(e) {
        // e.data contains received string.
        output("onmessage: " + e.data);
      };

      ws.onclose = function() {
        output("onclose");
      };

      ws.onerror = function(e) {
        output("onerror");
        console.log(e)
      };

    }

    function onSubmit() {
      var input = document.getElementById("input");
      // You can send message to the Web Socket using ws.send.
      ws.send(input.value);
      output("send: " + input.value);
      input.value = "";
      input.focus();
    }

    function onCloseClick() {
      ws.close();
    }

    function output(str) {
      var log = document.getElementById("log");
      var escaped = str.replace(/&/, "&amp;").replace(/</, "&lt;").
        replace(/>/, "&gt;").replace(/"/, "&quot;"); // "
      log.innerHTML = escaped + "<br>" + log.innerHTML;
    }

  </script>
</head>
<body onload="init();">
  <form onsubmit="onSubmit(); return false;">
    <input type="text" id="input">
    <input type="submit" value="Send">
    <button onclick="onCloseClick(); return false;">close</button>
  </form>
  <div id="log"></div>
</body>
</html>

```

As you can see, the client is also very simple.


### Test the client and server

Open 2 terminal tabs or windows. In the first, we will run our websocket server...

```
cd ~/dev/wsServer
source venv/bin/activate
python server.py
```

This will start the websocket server on port 9001. The client has this address hardcoded and knows to connect to this port. Now, in the second terminal tab / window, we will create a python http server to serve the client...

```
cd ~/dev/wsServer
python -m SimpleHTTPServer
```

Now we are serving the contents of the current folder to the web on port 8000.

Finally, open a web browser and visit `http://localhost:8000/client.html`. Open multiple tabs to the same web address, and you will see logs about these clients connecting in your first terminal (websocket server... not the python http server).

If you type a messages in one of the client pages, it should appear in the other client pages *magically*. Give it a try.

**Congatulations** - you just wrote your first websocket chat server.
