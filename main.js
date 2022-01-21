const opts = {
    errorEventName:'error',
        logDirectory:'logs',
        fileNamePattern:'log-<DATE>.log',
        dateFormat:'YYYY.MM.DD'
};
const log = require('simple-node-logger').createRollingFileLogger(opts);

require('dotenv').config();

const firebase = require("firebase");
const firebaseConfig = {
    appId: process.env.APP_ID,
    apiKey: process.env.API_KEY,
    projectId: process.env.PROJECT_ID,
    authDomain: process.env.AUTH_DOMAIN,
    databaseURL: process.env.DATABASE_URL,
    measurementId: process.env.MEASUREMENT_ID,
    storageBucket: process.env.STORAGE_BUCKET,
    messagingSenderId: process.env.MESSAGING_SENDER_ID,
};

firebase.initializeApp(firebaseConfig);

var db = firebase.firestore();
var staticQuestions = [];

db.collection('questions')
  .onSnapshot(querySnapshot => {´
    querySnapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
          staticQuestions.push({ id: change.doc.id, ...change.doc.data(), playerMade: false })
      }
      if (change.type === 'modified') {
          var question = staticQuestions.filter(q => q.id == change.doc.id)[0];
          question.text = change.doc.data().text; 
          question.type = change.doc.data().type; 
      }
      if (change.type === 'removed') {
        staticQuestions = staticQuestions.filter(q => q.id !== change.doc.id);
      }
    });

  });

const server = require('http').createServer();
const io = require('socket.io')(server);
const port = 3000;

server.listen(port, (err) => {
    if (err) {
        log.error(err);
        throw err;
    }
    console.log('Listening on port ' + port);
    log.info('Server started successfully.');
});

var rooms = [];
class Room {
    constructor(host) {
        this.id = generateUID();
        this.host = host;
        this.players = [];
        this.question = '';
        this.trash = [];
        this.queue = randomizeQueue(this.trash);
        this.playerMade = [];
        this.lastActive = new Date();
    }
}

io.on('connection', (socket) => {
    var room;
    socket.on('create', () => {
        room = new Room(socket);
        room.players.push(socket);
        rooms.push(room);
        socket.emit('init', room.id);
    });

    socket.on('join', (roomCode) => {
        room = rooms.find(room => room.id == roomCode);
        if (! room) {
            socket.emit('empty');
            return;
        };
        if (! room.players.includes(socket)) {
            room.players.push(socket);
        }
        socket.emit('init', room.id);
        room.lastActive = new Date();
    });

    socket.on('push', (question) => {
        if (! room) return;
        room.playerMade.push({ text: question.text,  type: question.type, playerMade: true });
        room.lastActive = new Date();
    });
    
    socket.on('next', () => {
        if (! room || room.host !== socket) return;
        room.queue.sort(function (a, b) { return 0.5 - Math.random() })
        if (room.queue.length) {
            room.question = room.queue.pop();
        } else {
            room.question = "slut på frågor";
        }

        let statics = staticQuestions.filter((q, index) => {
            return ! room.trash.includes(index);
        });
        if ((room.queue.filter(q => ! q.playerMade).length == 0 || ! room.playerMade.length) && ! statics.length == 0) {
            var index = Math.floor(Math.random()*statics.length);
            room.queue.push(statics[index]);
            room.trash.push(staticQuestions.indexOf(statics[index]));
        } else {
            if (! room.playerMade.length && ! room.queue.length) {
                room.players.forEach((player) => {
                    player.emit('done');
                });
            }

            if (room.playerMade.length) {
                var index = Math.floor(Math.random()*room.playerMade.length);
                room.queue.push(room.playerMade[index]);
                room.playerMade.splice(index, 1);
            }
        }
        room.players.forEach((player) => {
            player.emit('question', room.question);
        });
        room.lastActive = new Date();
    });

    socket.on('disconnect', () => {
        if (! room) return;
        room.players.splice(room.players.indexOf(socket), 1);
        room.lastActive = new Date();

        if (room.host == socket) {
            if (room.players.length > 0) {
                room.host = room.players[0];
                room.host.emit('host');
            } else {
                rooms.splice(rooms.indexOf(room), 1);
            }
        }
    });

    socket.on('admin-newQuestion', (question) => {
        if(! socket.admin) return;
        addQuestionToFirebase(question, (payload) => {
            socket.emit("admin-confirmCreate", payload)
        })
    });
    socket.on('admin-updateQuestion', (question) => {
        if(! socket.admin) return;
        updateQuestionInFirebase(question);
    });
    socket.on('admin-removeQuestion', (question) => {
        if(! socket.admin) return;
        deleteQuestionFromFirebase(question);
    });

    socket.on('admin-auth', (passwd) => {
        var ip = socket.request.connection.remoteAddress;

        if(passwd === "hemligt123") {
            socket.emit('admin-questions', staticQuestions);
            socket.admin = true;
            log.info("Successful login to admin from " + ip);
        } else {
            socket.emit('403');
            log.info("Failed login to admin from " + ip);
        }
    })

});

// Heartbeat
setInterval(() => {
    console.clear();
    rooms.forEach((room) => {
        var inactiveTimer = new Date(Math.abs(new Date() - room.lastActive));
        console.log(room.id + " (" +inactiveTimer.getMinutes()+ ")" + ": " + room.players.length);
        room.players.forEach((player) => {
            player.emit('question', room.question);
        });
        if (inactiveTimer.getMinutes() >= 20) {
            log.info(`Killed inactive room(${room.id}).`);
            rooms.splice(rooms.indexOf(room), 1);
        }
    });
}, 1000);

const uid = "ACDEFGHJKLMNPQRTUVWXYZ234679";
const uids = uid.length;
function generateUID() {
    let roomCode = "";
    for (var i=1; i<=3; i++) {
        roomCode += uid[Math.floor(Math.random()*uids)];
    }
    return roomCode;
}

function randomizeQueue(trash) {
    let queue = [];
    for (var i=0; i<5; i++) {
        var index = Math.floor(Math.random()*(staticQuestions.length));
        while (trash.includes(index)) {
            index = Math.floor(Math.random()*(staticQuestions.length));
        }
        queue.push(staticQuestions[index]);
        trash.push(index);
    }
    return queue;
}

function addQuestionToFirebase(question, callback) {
    db.collection("questions").add({
        text: question.text,
        type: question.type,
    })
    .then(function(docRef) {
        callback({ ...question, id: docRef.id, edit:false});
    })
    .catch(function(err) {
        log.error("Error adding document: ", err);
    });
}

function deleteQuestionFromFirebase(question) {
    db.collection("questions").doc(question.id).delete()
    .catch(function(err) {
        log.error("Error deleting document: ", err);
    });
}

function updateQuestionInFirebase(question) {
    db.collection("questions").doc(question.id).update({
        text: question.text,
        type: question.type,
    })
    .catch(function(err) {
        log.error("Error updating document: ", err);
    });
}

