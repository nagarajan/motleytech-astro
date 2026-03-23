var magicSquare = function () {

  let settings = {
    stepDelay: 1000,
    showArrows: true,
    resetOnDone: false
  }

  let rangeToDelay = {
    0: 5000,
    1: 3000,
    2: 2000,
    3: 1500,
    4: 1250,
    5: 1000,
    6: 500,
    7: 250,
    8: 125,
    9: 64,
    10: 32
  }

  let rangeToText = {
    0: "0.2x",
    1: "0.3x",
    2: "0.5x",
    3: "0.66x",
    4: "0.8x",
    5: "1.0x",
    6: "2.0x",
    7: "4.0x",
    8: "8.0x",
    9: "16.0x",
    10: "32.0x"
  }

  function initialize() {
    resetControls()
    onGenerate(true)
  }

  // called on clicking generate button
  function onGenerate(initial) {
    let inp = $("#sqsize").val()
    let res = parseInt(inp)
    if ((!res) || (res === undefined) || (res <= 2) || (res % 2 === 0) || (res >= 50)) {
      let msg = "Invalid input: '" + inp + "'."
      $("#errorspan").text(msg + " Valid: Odd number [3:49]")
      $("#sqsize").val("")
      return
    }
    $("#errorspan").text("")

    if (initial) {
      settings.stepDelay = 0
      settings.showArrows = false
      settings.resetOnDone = true
    } else {
      updateAnimSpeed()
      updateAnimShow()
      settings.resetOnDone = false
    }

    generateSquare("#magicsquare", res)
    $('#btngenerate').attr('disabled', '');
  }

  function onDone() {
    let doneDelay = 300
    if (settings.resetOnDone) {
      doneDelay = 10
    }
    setTimeout(function () {
      $('#btngenerate').removeAttr('disabled');
      $('#therealtable').css('animation-name', 'shine')
      $('#therealtable').css('animation-duration', '1s')
      if (settings.resetOnDone) {
        settings.resetOnDone = false
        resetControls()
      }
    }, doneDelay)
  }

  function resetControls() {
    settings.stepDelay = 1000
    settings.showArrows = true
    let sliderval = 5
    $('#aspeed').val(sliderval)
    $('#viewspeed').text(rangeToText[sliderval])
    $('#ashow').prop('checked', settings.showArrows)
  }

  function updateAnimSpeed() {
    let sliderval = parseInt($('#aspeed').val())
    settings.stepDelay = rangeToDelay[sliderval]
    $('#viewspeed').text(rangeToText[sliderval])
  }

  function updateAnimShow() {
    settings.showArrows = $('#ashow').is(':checked')
  }

  // generates the 2d array of magic square numbers
  function generateNumbersAndMoves(size) {
    let nums = []
    let moves = []

    // init with empty values
    for (let ix = 0; ix < size; ix++) {
      snums = []
      for (let iy = 0; iy < size; iy++) {
        snums.push(null)
      }
      nums.push(snums)
    }

    let cr = 0
    let cc = (size - 1) / 2
    let pr, pc
    let count = 0
    let element
    while (count < size * size) {
      count += 1
      nums[cr][cc] = count
      moves.push(['write', count, cr, cc]);
      if (count === size * size) {
        break
      }

      [pr, pc] = [cr, cc]
      cr = cr - 1
      cc = cc + 1
      if ((cr < 0) && (cc == size)) {
        cr = 1
        cc = size - 1
        moves.push(['walkout', 'corner', pr, pc])
      } else if (cr < 0) {
        cr = size - 1
        moves.push(['walkout', 'top', pr, pc])
      } else if (cc == size) {
        cc = 0
        moves.push(['walkout', 'right', pr, pc])
      } else if (nums[cr][cc] !== null) {
        cr = cr + 2
        cc = cc - 1
        moves.push(['bump', null, pr, pc])
      } else {
        moves.push(['move', null, pr, pc])
      }
    }

    return [nums, moves]
  }

  // verifies that the sum of rows, cols and diags are the expected value
  function verifyNumbers(nums, size) {
    let esum = size * (size * size + 1) / 2
    let verified = true

    // check the sums
    for (let ir = 0; ir < size; ir++) {
      let rsum = 0
      let csum = 0
      let d1sum = 0
      let d2sum = 0
      for (let ic = 0; ic < size; ic++) {
        rsum += nums[ir][ic]
        csum += nums[ic][ir]
        d1sum += nums[ic][ic]
      }
      if (rsum !== esum) {
        console.error(`Sum for row $(ir) ($(rsum)) does not match expected value ($(esum)).`)
        verified = false
      }
      if (csum !== esum) {
        console.error(`Sum for column $(ir) ($(csum)) does not match expected value ($(esum)).`)
        verified = false
      }
    }

    let d1sum = 0
    let d2sum = 0
    for (let ir = 0; ir < size; ir++) {
      d1sum += nums[ir][ir]
      d2sum += nums[size-ir-1][ir]
    }
    if (d1sum !== esum) {
      console.error(`Sum for first diagonal ($(d1sum)) does not match expected value ($(esum)).`)
      verified = false
    }
    if (d2sum !== esum) {
      console.error(`Sum for second diagonal ($(d2sum)) does not match expected value ($(esum)).`)
      verified = false
    }

    return verified
  }

  function createEmptyTable(size) {
    let htmlStr = "<table id='therealtable'>"

    for (let cr = 0; cr < size; cr++) {
      htmlStr += "<tr>"
      for (let cc = 0; cc < size; cc++) {
        htmlStr += '<td id="rc_' + cr + '_' + cc + '">'
        htmlStr += "</td>"
      }
      htmlStr += "</tr>"
    }

    htmlStr += "</table>"
    return htmlStr
  }

  function getCallWidthAndHeight() {
    let cwidth, cheight
    let element1 = "#rc_1_0"
    let element2 = "#rc_0_1"

    let pos1 = $(element1).offset()
    let pos2 = $(element2).offset()
    cwidth = pos2.left - pos1.left
    cheight = pos1.top - pos2.top

    return [cwidth, cheight]
  }

  function delayedShowAndFadeEl(elem, dstart, tshow, tfade, positionEl) {
    if (!settings.showArrows) {
      return
    }
    setTimeout(function () {
      $(elem).css('opacity', 1)
      $(elem).show()
      positionEl()
    }, dstart)
    setTimeout(function () {
      $(elem).fadeOut(tfade)
    }, dstart + tshow)
    setTimeout(function () {
      $(elem).show()
      $(elem).css('opacity', 0)
    }, dstart + tshow + tfade)
  }

  function playMoves(moves, size) {
    let [cwidth, cheight] = getCallWidthAndHeight()
    cwidth = cwidth / 2
    cheight = cheight / 2

    function playOneMove(moves, size, mnum) {
      function nextMove(delay) {
        setTimeout(function () {
          playOneMove(moves, size, mnum + 1)
        }, delay)
      }

      if (mnum >= moves.length) {
        onDone()
        return
      }

      let move = moves[mnum]
      let [type, val, r, c] = move
      let element = "#rc_" + r + "_" + c
      let pos = $(element).offset()
      let [top, left] = [pos.top, pos.left]
      let [atop, aleft] = [pos.top - cheight - 2, pos.left + cwidth]
      let [ntop, nleft] = [pos.top - 1.5*cheight, pos.left + 2*cwidth + 10]
      let [btop, bleft] = [pos.top + 40, pos.left + 5]

      if (type === 'write') {
        let count = val
        $(element).text(count)
        $(element).css('animation-name', 'shine')
        $(element).css('animation-duration', '0.35s')
        nextMove(settings.stepDelay)
        return
      } else if (type === 'move') {
        let arrowEl = '#greenarrowtopright'
        delayedShowAndFadeEl(arrowEl,
            1,
            settings.stepDelay,
            settings.stepDelay*0.25,
            function () {
              $(arrowEl).offset({top:atop, left:aleft})
        })
        nextMove(settings.stepDelay)
        return
      } else if (type === 'bump') {
        let arrowEl1 = '#redarrowtopright'
        let arrowEl2 = '#greenarrowdown'
        delayedShowAndFadeEl(arrowEl1,
            1,
            settings.stepDelay,
            settings.stepDelay * 0.5,
            function () {
              $(arrowEl1).offset({top:atop, left:aleft})
        })
        delayedShowAndFadeEl(arrowEl2,
            settings.stepDelay,
            settings.stepDelay,
            settings.stepDelay * 0.5,
            function () {
              $(arrowEl2).offset({top:btop, left:bleft})
        })
        nextMove(settings.stepDelay * 2)
        return

      } else if (type === 'walkout') {
        if (val === 'corner') {
          let arrowEl1 = '#orangearrowtopright'
          let arrowEl2 = '#redarrowleft'
          let arrowEl3 = '#redarrowdown'
          let arrowEl4 = '#greenarrowdown'
          delayedShowAndFadeEl(arrowEl1,
              1,
              settings.stepDelay*2,
              settings.stepDelay * 0.5,
              function () {
                $(arrowEl1).offset({top:atop, left:aleft})
          })
          delayedShowAndFadeEl(arrowEl2,
              settings.stepDelay,
              settings.stepDelay,
              settings.stepDelay * 0.5,
              function () {
                $(arrowEl2).offset({top:ntop, left:nleft - 2*cwidth})
          })
          delayedShowAndFadeEl(arrowEl3,
              settings.stepDelay,
              settings.stepDelay,
              settings.stepDelay * 0.5,
              function () {
                $(arrowEl3).offset({top:ntop + cheight + 10, left:nleft - 10 })
          })
          delayedShowAndFadeEl(arrowEl4,
              settings.stepDelay * 2,
              settings.stepDelay,
              settings.stepDelay * 0.5,
              function () {
                $(arrowEl4).offset({top:btop, left:bleft})
          })
          nextMove(settings.stepDelay * 3)
          return

        } else if ((val === 'top') || (val === 'right')) {
          let arrowEl1 = '#orangearrowtopright'
          let arrowEl2 = '#greenarrowdown'
          let [ptop, pleft] = [ntop, nleft]
          if (val === 'right') {
            arrowEl2 = '#greenarrowleft'
            pleft = nleft - 10
            ptop = ntop - 5
          }
          delayedShowAndFadeEl(arrowEl1,
              1,
              settings.stepDelay,
              settings.stepDelay * 0.5,
              function () {
                $(arrowEl1).offset({top:atop, left:aleft})
          })
          delayedShowAndFadeEl(arrowEl2,
              settings.stepDelay,
              settings.stepDelay,
              settings.stepDelay * 0.5,
              function () {
                $(arrowEl2).offset({top:ptop, left:pleft})
          })
          nextMove(settings.stepDelay * 2)
          return
        }
        nextMove(settings.stepDelay)
        return
      }

      nextMove(0)
    }
    playOneMove(moves, size, 0)
  }

  // the main function which generates numbers and creates table which
  // represents the magic square
  function generateSquare(divid, size) {

    let table = createEmptyTable(size)
    let sum = size * (size * size + 1) / 2

    $(divid).empty()
    $(divid).append('<p><b>Sum</b> : ' + sum + '</p>')
    $(divid).append(table)

    let [numbers, moves] = generateNumbersAndMoves(size)

    playMoves(moves, size)

    let verified = verifyNumbers(numbers, size)
    if (!verified) {
      alert('The magic square failed verification. Check logs.')
    }
  }

  return {
      initialize: initialize,
      generateSquare: generateSquare,
      onGenerate: onGenerate,
      updateAnimSpeed: updateAnimSpeed,
      updateAnimShow: updateAnimShow
  }
}()
