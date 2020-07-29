const fs = require('fs');

let staticQuestions = JSON.parse(fs.readFileSync('Questions.json'));
staticQuestions = staticQuestions.map(question => {
    return {playerMade: false, question: question}
});

const server = require('http').createServer();
const io = require('socket.io')(server);
const port = 3000;

server.listen(port, (err) => {
    if (err) throw err
    console.log('Listening on port ' + port);
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
        room.players.push(socket);
        socket.emit('init', room.id);
    });

    socket.on('push', (question) => {
        if (! room) return;
        room.playerMade.push({playerMade: true, question: question});
    });
    
    socket.on('next', () => {
        if (! room || room.host !== socket) return;
        room.queue.sort(function (a, b) { return 0.5 - Math.random() })
        if (room.queue.length) {
            room.question = room.queue.pop().question;
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
    });

    socket.on('disconnect', () => {
        if (! room) return;
        room.players.splice(room.players.indexOf(socket), 1);
        
        if (room.host == socket) {
            if (room.players.length > 0) {
                room.host = room.players[0];
                room.host.emit('host');
            } else {
                rooms.splice(rooms.indexOf(room), 1);
            }
        }
    });
});

setInterval(() => {
    console.clear();
    rooms.forEach((room) => {
        console.log(room.id + ": " + room.players.length);
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