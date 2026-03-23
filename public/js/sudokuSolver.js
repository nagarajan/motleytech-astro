var sudokuSolver = function () {

    let settings = {}

    let floor = Math.floor

    function time() {
        return (new Date()).getTime()
    }

    function nkeys(dict) {
        return Object.keys(dict).length
    }

    // returns a range as a list
    function range(start, stop, step) {
        let result = []
        if (step === undefined) {
            step = 1
        }
        if (stop === undefined) {
            stop = start
            start = 0
        }
        if (step > 0) {
            for (let ix = start; ix < stop; ix += step) {
                result.push(ix)
            }
        } else {
            for (let ix = start; ix > stop; ix += step) {
                result.push(ix)
            }
        }

        return result
    }

    let xrange = range

    function shuffle(array) {
        var m = array.length, t, i;

        // While there remain elements to shuffle…
        while (m) {
            // Pick a remaining element…
            i = floor(Math.random() * m--);

            // And swap it with the current element.
            t = array[m];
            array[m] = array[i];
            array[i] = t;
        }

        return array;
    }

    // shortcut to sort things
    // let points = [5,4,2,3,7,1]
    // points.sort(function(a, b){return b-a});

    test_cases = [
        ['already solved',
         "974236158638591742125487936316754289742918563589362417867125394253649871491873625",
         "974236158638591742125487936316754289742918563589362417867125394253649871491873625",
         true,
         ],
        ['one unknown',
         "2.6489173374615982981723456593274861712836549468591327635147298127958634849362715",
         "256489173374615982981723456593274861712836549468591327635147298127958634849362715",
         true,
         ],
        ['naked singles',
         "3.542.81.4879.15.6.29.5637485.793.416132.8957.74.6528.2413.9.655.867.192.965124.8",
         "365427819487931526129856374852793641613248957974165283241389765538674192796512438",
         true,
         ],
        ['hidden singles',
         "..2.3...8.....8....31.2.....6..5.27..1.....5.2.4.6..31....8.6.5.......13..531.4..",
         "672435198549178362831629547368951274917243856254867931193784625486592713725316489",
         true,
         ],
        ['too few numbers',
         "..9.7...5..21..9..1...28....7...5..1..851.....5....3.......3..68........21.....87",
         "",
         false,
         ],
    ]

    function updateSquare(possb, offset, val) {
        let pdict = possb[offset]
        if (pdict[val] !== undefined) {
            if (nkeys(pdict) === 1) {
                return false
            }
            delete pdict[val]
        }
        return true
    }

    function updateRow(possb, pos, val) {
        let rr = floor(pos/9)
        for (let ov of xrange(rr * 9, (rr+1) * 9)) {
            if (updateSquare(possb, ov, val) === false) {
                return false
            }
        }
    }

    function updateCol(possb, pos, val) {
        let cc = pos%9
        for (let ov of xrange(cc, 81, 9)) {
            if (updateSquare(possb, ov, val) === false) {
                return false
            }
        }
    }

    function updateCell(possb, pos, val) {
        let sc = floor(pos/27)*27 + floor((pos%9)/3)*3
        for (let addv of [0, 1, 2, 9, 10, 11, 18, 19, 20]) {
            if (updateSquare(possb, sc + addv, val) === false) {
                return false
            }
        }
    }

    function updateAll(possb, pos, val) {
        if ((updateRow(possb, pos, val) === false) ||
            (updateCol(possb, pos, val) === false) ||
            (updateCell(possb, pos, val) === false)) {
            return false
        }
        return true
    }


    function initPossibilities(possb, ins) {
        for (let rr of xrange(9)) {
            for (let cc of xrange(9)) {
                let pos = rr*9 + cc
                let val = ins[pos]
                if (val !== 0) {
                    // update row, col and cell
                    if (possb[pos][val] === undefined) {
                        return false
                    }

                    possb[pos] = {}

                    // update all
                    if (updateAll(possb, pos, val) === false) {
                        console.log("Failed in initializing possibilities")
                        return false
                    }
                }
            }
        }
        return possb
    }

    // creates new dict with same keys and values
    function copydict(dict) {
        let newdict = {}

        Object.keys(dict).forEach(key => (newdict[key] = dict[key]))
        return newdict
    }

    function deepcopy(listOfDicts) {
        return listOfDicts.map( dict => copydict(dict) )
    }

    function solveSudoku(possb, ss) {
        let changed = true
        while (changed === true) {
            changed = false
            for (let pos of xrange(81)) {
                if (nkeys(possb[pos]) === 1) {
                    changed = true
                    let val = Object.keys(possb[pos])[0]
                    delete possb[pos][val]
                    ss[pos] = parseInt(val)
                    if (updateAll(possb, pos, val) === false) {
                        return false
                    }
                }
            }
        }

        let guessPos = null
        for (let pos of xrange(81)) {
            if (nkeys(possb[pos]) > 1) {
                guessPos = pos
                break
            }
        }

        if (guessPos === null) {
            return ss
        }

        let ss2 = ss.slice(0)
        let guessValues = Object.keys(possb[guessPos])
        shuffle(guessValues)
        let retval
        for (let guess of guessValues) {
            let possb2 = deepcopy(possb)
            possb2[guessPos] = {}
            ss2[guessPos] = parseInt(guess)
            if (updateAll(possb2, guessPos, guess) === false) {
                return false
            }
            retVal = solveSudoku(possb2, ss2)
            if (retVal !== false) {
                return retVal
            }
        }
        return false
    }


    function getCell(sdk, cell) {
        let cs = floor(cell/3)*27 + (cell%3)*3
        let cellv = [0,1,2,9,10,11,18,19,20].map( x => sdk[cs + x] )
        return cellv
    }

    function listcmp(la, lb) {
        if (la.length !== lb.length) {
            return false
        }

        // sort lb in ascending order
        lb.sort( (a, b) => (a-b) )

        for (let ix in la) {
            if (la[ix] !== lb[ix]) {
                return false
            }
        }
        return true
    }

    function checkSolution(outs) {
        let list9 = xrange(1,10)
        let currlist

        // check rows
        for (let rr of range(9)) {
            currlist = xrange(9).map( x => outs[rr*9 + x] )
            if (listcmp(list9, currlist) === false) {
                console.log(`Error in row ${rr}.\nRow = ${currlist}`)
                return false
            }
        }

        // check columns
        for (let cc of range(9)) {
            currlist = xrange(9).map( x => outs[x*9 + cc] )
            if (listcmp(list9, currlist) === false) {
                console.log(`Error in column ${cc}.\nCol = ${currlist}`)
                return false
            }
        }

        // check cells
        for (let cell of range(9)) {
            currlist = getCell(outs, cell)
            if (listcmp(list9, currlist) === false) {
                console.log(`Error in cell ${cell}.\nCell = ${currlist}`)
                return false
            }
        }

        return "Solution checks out..."
    }


    function formatSudoku(outs) {
        let data = outs
        data = range(27).map( x => data.slice(x*3, x*3 + 3).join(' ') )
        data = range(9).map( x => data.slice(x*3, x*3 + 3).join('   ') )
        data = range(3).map( x => data.slice(x*3, x*3 + 3).join('\n') )
        data = data.join('\n\n')

        return '\n' + data + '\n'
    }


    function stringToList(inp) {
        inp = inp.replace(/\./g, '0')
        let result = []
        for (let x of inp) {
          result.push(x)
        }
        result = result.map( x => parseInt(x) )
        return result
    }

    function listToString(inp) {
        return inp.join("")
    }

    function dictFromKeys(ks, val) {
        let dict = {}
        ks.forEach( k => (dict[k] = val) )
        return dict
    }

    function solveFromInput(inp) {
        let sudokuInput = stringToList(inp)
        let possibilities = range(9*9).map( x => dictFromKeys(range(1, 10), true) )
        let possb = initPossibilities(possibilities, sudokuInput)
        if (possb === false) {
            console.error("No possibilities found")
            return 'nopossb'
        }

        let st = time()
        return solveSudoku(possb, sudokuInput)
        let et = time()
    }

    function runTests() {
        for (let data of test_cases) {
            let [name, inp, outp, valid] = data
            if (true) {
                let st = time()
                let result = solveFromInput(inp)
                let et = time()

                if (result === 'nopossb') {
                    continue
                }

                if (result === false) {
                    let msg = `Failed to find solution for test "${name}". `
                    if (valid === true) {
                        console.error(msg + "Unexpected failure")
                    } else {
                        console.warn(msg + "But it is an expected failure... rejoice")
                    }

                    continue
                } else {
                    console.log(formatSudoku(result))
                    console.log(checkSolution(result))
                    console.log(`Took ${et - st} ms`)
                }

                if (listToString(result) === outp) {
                    console.info(`Test \"${name}\" passed.`)
                } else {
                    console.error(`Test \"${name}\" failed.`)
                }
            }
        }
    }

    function initialize(tablediv, progdiv) {
        settings.tablediv = tablediv
        settings.progdiv = progdiv

        let table = createSudokuTable()
        $(tablediv).empty()
        $(tablediv).append(table)
    }

    function createInnerTable(ofr, ofc) {
        let hstr = "<table class='innertable'>"
        let id
        for (let cr of range(3)) {
            hstr += "<tr>"
            for (let cc of range(3)) {
                hstr += "<td>"
                id = `rc_${ofr+cr}_${ofc+cc}`
                hstr += `<input id='${id}' type="text" pattern="[1-9]" class="form-control sudokuinput" value=""/>`
                hstr += "</td>"
            }
            hstr += "</tr>"
        }
        hstr += "</table>"
        return hstr
    }

    function createSudokuTable() {
        let htmlStr = "<table id='sudokutable'>"
        let id

        for (let cr of range(3)) {
            htmlStr += "<tr>"
            for (let cc of range(3)) {
                htmlStr += '<td>'
                htmlStr += createInnerTable(cr*3, cc*3)
                htmlStr += "</td>"
            }
            htmlStr += "</tr>"
        }

        htmlStr += "</table>"
        return htmlStr
    }

    function populateTable(res, inp) {
        let idx
        let el
        for (let row of range(9)) {
            for (let col of range(9)) {
                idx = row*9 + col
                if (inp[idx] === '.') {
                    el = $(`#rc_${row}_${col}`)
                    el.val(res[idx])
                    el.addClass('bluebg')
                }
            }
        }
    }

    function disableControls() {
        $('#btnsolve').attr('disabled', '')
        $('#btnreset').attr('disabled', '')
        $('#statustext').text("Please wait. Working on it...")
        $("#errortext").text("")
    }

    function enableControls() {
        $('#btnsolve').removeAttr('disabled')
        $('#btnreset').removeAttr('disabled')
        $('#statustext').text("")
    }

    function startSolve() {
        // read the values into a string
        let inp = ''
        let val
        let valid = { '': '.' }
        range(1, 10).map( x => (valid[x] = x))

        for (let row of range(9)) {
            for (let col of range(9)) {
                val = $(`#rc_${row}_${col}`).val()
                if (valid[val] !== undefined) {
                    inp += valid[val]
                } else {
                    $('#errortext').text(`Invalid Input at (${row+1},${col+1}): "${val}".\nFix input and try again.`)
                    setTimeout(enableControls, 200)
                    return
                }
            }
        }
        console.log(inp)

        let st = time()
        let result = solveFromInput(inp)
        let et = time()

        if (result === 'nopossb') {
            $('#errortext').text('Bad problem. No solution is possible')
            setTimeout(enableControls, 200)
            return
        }

        if (result === false) {
            console.log('Failed to find solution.')
            setTimeout(enableControls, 200)
            return
        } else {
            console.log(formatSudoku(result))
            console.log(checkSolution(result))
            console.log(`Took ${et - st} ms`)
            populateTable(result, inp)
        }
        setTimeout(enableControls, 200)
    }

    function onSolve() {
        setTimeout(disableControls, 100)
        setTimeout(startSolve, 200)
    }

    function onReset() {
        for (let row of range(9)) {
            for (let col of range(9)) {
                let id = `#rc_${row}_${col}`
                $(id).val('')
                $(id).removeClass('bluebg')
            }
        }
        $('#errortext').text('')
    }

    return {
        solveSudoku: solveSudoku,
        initialize: initialize,
        onSolve: onSolve,
        onReset: onReset,
        runTests: runTests,
    }
}()
