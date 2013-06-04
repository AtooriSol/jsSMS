/**
 * jsSMS - A Sega Master System/Game Gear emulator in JavaScript
 * Copyright (C) 2012  Guillaume Marty (https://github.com/gmarty)
 * Based on JavaGear Copyright (c) 2002-2008 Chris White
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

/** @const */ var UINT8 = 1;
/** @const */ var INT8 = 2;
/** @const */ var UINT16 = 3;

// List of high level node types. Think of it as basic blocks of AST.
var n = {
  'IfStatement': function(test, consequent, alternate) {
    if (alternate == undefined) alternate = null;
    return {
      'type': 'IfStatement',
      'test': test,
      'consequent': consequent,
      'alternate': alternate
    };
  },
  'BlockStatement': function(body) {
    if (body == undefined) body = [];
    return {
      'type': 'BlockStatement',
      'body': body
    };
  },
  'ExpressionStatement': function(expression) {
    return {
      'type': 'ExpressionStatement',
      'expression': expression
    };
  },
  // This is not a real AST block, but it's convenient for manipulating registers in optimizer.
  'Register': function(name) {
    return {
      'type': 'Register',
      'name': name
    };
  },
  'Identifier': function(name) {
    return {
      'type': 'Identifier',
      'name': name
    };
  },
  'Literal': function(value) {
    return {
      'type': 'Literal',
      'value': value
    };
  },
  'CallExpression': function(callee, args) {
    if (args == undefined) args = [];
    if (!Array.isArray(args)) args = [args];
    return {
      'type': 'CallExpression',
      'callee': n.Identifier(callee),
      'arguments': args
    };
  },
  'AssignmentExpression': function(operator, left, right) {
    return {
      'type': 'AssignmentExpression',
      'operator': operator,
      'left': left,
      'right': right
    };
  },
  'BinaryExpression': function(operator, left, right) {
    return {
      'type': 'BinaryExpression',
      'operator': operator,
      'left': left,
      'right': right
    };
  },
  'MemberExpression': function(object, property) {
    return {
      'type': 'MemberExpression',
      'computed': true, // Generate `object[property]`.
      'object': object,
      'property': property
    };
  },
  'ReturnStatement': function(argument) {
    if (argument == undefined) argument = null;
    return {
      'type': 'ReturnStatement',
      'argument': argument
    };
  }
};

// List of common operations for the Z80.
// Each entry returns a function accepting an optional parameter.
var o = {
  'NOOP': function() {
    return function() {
      return;
    }
  },
  'LD8': function(srcRegister, dstRegister1, dstRegister2) {
    if (dstRegister1 == undefined && dstRegister2 == undefined)
      // Direct value assignment (ex: `LD B,n`).
      return function(value) {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister), n.Literal(value))
        );
      };
    else if (dstRegister2 == undefined)
      // Register assignment (ex: `LD B,C`).
      return function() {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister), n.Register(dstRegister1))
        );
      };
    else if (dstRegister1 == 'n' && dstRegister2 == 'n')
      // Direct address value assignment (ex: `LD A,(nn)`).
      return function(value) {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister), o.READ_MEM8(n.Literal(value)))
        );
      };
    else
      // Register address value assignment (ex: `LD A,(BC)`).
      return function() {
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register(srcRegister),
            o.READ_MEM8(n.CallExpression('get' + (dstRegister1 + dstRegister2).toUpperCase()))
            )
        );
      };
  },
  'LD16': function(srcRegister1, srcRegister2, dstRegister1, dstRegister2) {
    if (dstRegister1 == undefined && dstRegister2 == undefined)
      // Direct value assignment (ex: `LD HL,nn`).
      return function(value) {
        return n.ExpressionStatement(
            n.CallExpression('set' + (srcRegister1 + srcRegister2).toUpperCase(), n.Literal(value))
        );
      };
    else if (dstRegister1 == 'n' && dstRegister2 == 'n')
      // Direct address value assignment (ex: `LD HL,(nn)`).
      return function(value) {
        return n.ExpressionStatement(
            n.CallExpression('set' + (srcRegister1 + srcRegister2).toUpperCase(), o.READ_MEM16(n.Literal(value)))
        );
      };
    else
      throw Error('Wrong parameters number');
  },
  'LD_WRITE_MEM': function(srcRegister1, srcRegister2, dstRegister1, dstRegister2) {
    if (dstRegister1 == undefined && dstRegister2 == undefined)
      // Direct value assignment (ex: `LD (HL),n`).
      return function(value) {
        return n.ExpressionStatement(
            n.CallExpression('writeMem', [n.CallExpression('get' + (srcRegister1 + srcRegister2).toUpperCase()), n.Literal(value)])
        );
      };
    else if (srcRegister1 == 'n' && srcRegister2 == 'n' && dstRegister2 == undefined)
      // Direct address assignment (ex: `LD (nn),A`).
      return function(value) {
        return n.ExpressionStatement(
            n.CallExpression('writeMem', [n.Literal(value), n.Register(dstRegister1)])
        );
      };
    else if (srcRegister1 == 'n' && srcRegister2 == 'n')
      // Direct address assignment (ex: `LD (nn),HL`).
      return function(value) {
        return [
          n.ExpressionStatement(
              n.CallExpression('writeMem', [n.Literal(value), n.Register(dstRegister2)])
          ),
          n.ExpressionStatement(
              n.CallExpression('writeMem', [n.Literal(value + 1), n.Register(dstRegister1)])
          )
        ];
      };
    else
      // Register assignment (ex: `LD (BC),a`).
      return function() {
        return n.ExpressionStatement(
            n.CallExpression('writeMem', [n.CallExpression('get' + (srcRegister1 + srcRegister2).toUpperCase()), n.Register(dstRegister1)])
        );
      };
  },
  'LD_SP': function() {
    return function(value) {
      return n.ExpressionStatement(
          n.AssignmentExpression('=', n.Identifier('sp'), n.Literal(value))
      );
    };
  },
  'INC8': function(register) {
    return function() {
      return n.ExpressionStatement(
          n.AssignmentExpression('=', n.Register(register), n.CallExpression('inc8', n.Register(register)))
      );
    };
  },
  'INC16': function(register1, register2) {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('inc' + (register1 + register2).toUpperCase())
      );
    };
  },
  'DEC8': function(register) {
    return function() {
      return n.ExpressionStatement(
          n.AssignmentExpression('=', n.Register(register), n.CallExpression('dec8', n.Register(register)))
      );
    };
  },
  'DEC16': function(register1, register2) {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('dec' + (register1 + register2).toUpperCase())
      );
    };
  },
  'ADD16': function(register1, register2, register3, register4) {
    return function() {
      // setHL(add16(getHL(), getBC()));
      return n.ExpressionStatement(
          n.CallExpression('set' + (register1 + register2).toUpperCase(),
          n.CallExpression('add16',
          [n.CallExpression('get' + (register1 + register2).toUpperCase()),
           n.CallExpression('get' + (register3 + register4).toUpperCase())]
          )
          )
      );
    };
  },
  'EX_AF': function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('exAF')
      );
    };
  },
  'RLA': function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('rla_a')
      );
    };
  },
  'RRA': function() {
    return function() {
      return n.ExpressionStatement(
          n.CallExpression('rra_a')
      );
    };
  },
  'ADD': function(register1, register2) {
    if (register1 == undefined && register2 == undefined)
      return function(value) {
        // 0 arguments.
        return n.ExpressionStatement(
            n.CallExpression('add_a', n.Literal(value))
        );
      };
    if (register2 == undefined)
      return function() {
        // 1 argument.
        return n.ExpressionStatement(
            n.CallExpression('add_a', n.Register(register1))
        );
      };
    else
      return function() {
        // 2 arguments.
        return n.ExpressionStatement(
            n.CallExpression('add_a', o.READ_MEM8(n.CallExpression('get' + (register1 + register2).toUpperCase())))
        );
      };
  },
  'SUB': function(register) {
    if (register == undefined)
      // sub_a(value);
      return function(value, target, currentAddress) {
        return n.ExpressionStatement(
            n.CallExpression('sub_a', n.Literal(value))
        );
      };
    else
      return function() {
        // sub_a(b);
        return n.ExpressionStatement(
            n.CallExpression('sub_a', n.Register(register))
        );
      };
  },
  'AND': function(register) {
    if (register == undefined)
      return function(value, target, currentAddress) {
        // a &= value; f = SZP_TABLE[a] | F_HALFCARRY;
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('&=', n.Register('a'), n.Literal(value))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.BinaryExpression('|',
                n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')),
                n.Literal(F_HALFCARRY)
              )
              )
          )
        ];
      };
    else if (register != 'a')
      return function() {
        // a &= b; f = SZP_TABLE[a] | F_HALFCARRY;
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('&=', n.Register('a'), n.Register(register))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.BinaryExpression('|',
                n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')),
                n.Literal(F_HALFCARRY)
              )
              )
          )
        ];
      };
    else
      return function() {
        // f = SZP_TABLE[a] | F_HALFCARRY;
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('f'),
            n.BinaryExpression('|',
            n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')),
            n.Literal(F_HALFCARRY)
            )
            )
        );
      };
  },
  'XOR': function(register) {
    if (register == undefined)
      return function(value, target, currentAddress) {
        // a ^= value; f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('^=', n.Register('a'), n.Literal(value))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
    else if (register != 'a')
      return function() {
        // a ^= b; f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('^=', n.Register('a'), n.Register(register))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
    else
      return function() {
        // a = 0; f = SZP_TABLE[0];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('a'), n.Literal(0))
          ),
          n.ExpressionStatement(
              // @todo Find a better way of calling `SZP_TABLE` than `sms.cpu.SZP_TABLE`.
              n.AssignmentExpression('=', n.Register('f'), n.Literal(sms.cpu.SZP_TABLE[0]))
          )
        ];
      };
  },
  'OR': function(register) {
    if (register != 'a')
      return function() {
        // a |= b; f = SZP_TABLE[a];
        return [
          n.ExpressionStatement(
              n.AssignmentExpression('|=', n.Register('a'), n.Register(register))
          ),
          n.ExpressionStatement(
              n.AssignmentExpression('=', n.Register('f'),
              n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a'))
              )
          )
        ];
      };
    else
      return function() {
        // f = SZP_TABLE[a];
        return n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('f'), n.MemberExpression(n.Identifier('SZP_TABLE'), n.Register('a')))
        );
      };
  },
  'JR': function(test) {
    return function(value, target) {
      // if (test) {pc = target; tstates -= 5;}
      return n.IfStatement(
          test,
          n.BlockStatement([
            n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
            n.ExpressionStatement(n.AssignmentExpression('-=', n.Identifier('tstates'), n.Literal(5)))
          ])
      );
    };
  },
  'DJNZ': function() {
    return function(value, target) {
      // b = (b - 1) & 0xFF; if (b != 0) {pc = target; tstates -= 5;}
      return [
        n.ExpressionStatement(
            n.AssignmentExpression('=', n.Register('b'), n.BinaryExpression('&', n.BinaryExpression('-', n.Register('b'), n.Literal(1)), n.Literal(0xFF)))
        ),
        o.JR(n.BinaryExpression('!=', n.Register('b'), n.Literal(0)))(undefined, target)
      ];
    };
  },
  'RET': function(operator, bitMask) {
    if (operator == undefined && bitMask == undefined)
      return function() {
        // pc = readMemWord(sp); sp += 2; return;
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), o.READ_MEM16(n.Identifier('sp')))),
          n.ExpressionStatement(n.AssignmentExpression('+=', n.Identifier('sp'), n.Literal(2))),
          n.ReturnStatement()
        ];
      };
    else
      return function() {
        // ret((f & F_ZERO) == 0);
        return n.ExpressionStatement(
            n.CallExpression('ret', n.BinaryExpression(operator,
            n.BinaryExpression('&', n.Register('f'), n.Literal(bitMask)),
            n.Literal(0)
            ))
        );
      };
  },
  'JP': function(operator, bitMask) {
    if (operator == undefined && bitMask == undefined)
      return function(value, target, currentAddress) {
        // pc = readMemWord(target); return;
        return [
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
          n.ReturnStatement()
        ];
      };
    else
      return function(value, target) {
        // if ((f & F_SIGN) != 0) {pc = target; return;}
        return n.IfStatement(
            n.BinaryExpression(operator,
            n.BinaryExpression('&', n.Register('f'), n.Literal(bitMask)),
            n.Literal(0)
            ),
            n.BlockStatement([
              n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
              n.ReturnStatement()
            ])
        );
      };
  },
  'CALL': function(operator, bitMask) {
    if (operator == undefined && bitMask == undefined)
      return function(value, target, currentAddress) {
        // push1(currentAddress + 2); pc = target; return;
        return [
          n.ExpressionStatement(n.CallExpression('push1', n.Literal(currentAddress + 2))),
          n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
          n.ReturnStatement()
        ];
      };
    else
      return function(value, target, currentAddress) {
        // if ((f & F_ZERO) == 0) {push1(currentAddress + 2); pc = target; tstates -= 7; return;}
        return n.IfStatement(
            n.BinaryExpression(operator,
            n.BinaryExpression('&', n.Register('f'), n.Literal(bitMask)),
            n.Literal(0)
            ),
            n.BlockStatement([
              n.ExpressionStatement(n.CallExpression('push1', n.Literal(currentAddress + 2))),
              n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(target))),
              n.ExpressionStatement(n.AssignmentExpression('-=', n.Identifier('tstates'), n.Literal(7))),
              n.ReturnStatement()
            ])
        );
      };
  },
  'RST': function(targetAddress) {
    return function(value, target, currentAddress) {
      // push1(currentAddress); pc = target; return;
      return [
        n.ExpressionStatement(n.CallExpression('push1', n.Literal(currentAddress))),
        n.ExpressionStatement(n.AssignmentExpression('=', n.Identifier('pc'), n.Literal(targetAddress))),
        n.ReturnStatement()
      ];
    };
  },
  // Below these point, properties can't be called from outside object `n`.
  // Move to object `o`? Mark as private?
  'READ_MEM8': function(value) {
    return n.CallExpression('readMem', value);
  },
  'READ_MEM16': function(value) {
    return n.CallExpression('readMemWord', value);
  }
};

var opcodeTable = [
  //0x00:
  {
    name: 'NOP',
    ast: o.NOOP()
  },
  //0x01:
  {
    name: 'LD BC,nn',
    ast: o.LD16('b', 'c'),
    operand: UINT16
  },
  //0x02:
  {
    name: 'LD (BC),A',
    ast: o.LD_WRITE_MEM('b', 'c', 'a')
  },
  //0x03:
  {
    name: 'INC BC',
    ast: o.INC16('b', 'c')
  },
  //0x04:
  {
    name: 'INC B',
    ast: o.INC8('b')
  },
  //0x05:
  {
    name: 'DEC B',
    ast: o.DEC8('b')
  },
  //0x06:
  {
    name: 'LD B,n',
    ast: o.LD8('b'),
    operand: UINT8
  },
  //0x07:
  {
    name: 'RLCA'
  },
  //0x08:
  {
    name: 'EX AF AF\'',
    ast: o.EX_AF()
  },
  //0x09:
  {
    name: 'ADD HL,BC',
    ast: o.ADD16('h', 'l', 'b', 'c')
  },
  //0x0A:
  {
    name: 'LD A,(BC)',
    ast: o.LD8('a', 'b', 'c')
  },
  //0x0B:
  {
    name: 'DEC BC',
    ast: o.DEC16('b', 'c')
  },
  //0x0C:
  {
    name: 'INC C',
    ast: o.INC8('c')
  },
  //0x0D:
  {
    name: 'DEC C',
    ast: o.DEC8('c')
  },
  //0x0E:
  {
    name: 'LD C,n',
    ast: o.LD8('c'),
    operand: UINT8
  },
  //0x0F:
  {
    name: 'RRCA'
  },
  //0x10:
  {
    name: 'DJNZ (PC+e)',
    ast: o.DJNZ(),
    operand: INT8
  },
  //0x11:
  {
    name: 'LD DE,nn',
    ast: o.LD16('d', 'e'),
    operand: UINT16
  },
  //0x12:
  {
    name: 'LD (DE),A',
    ast: o.LD_WRITE_MEM('d', 'e', 'a')
  },
  //0x13:
  {
    name: 'INC DE',
    ast: o.INC16('d', 'e')
  },
  //0x14:
  {
    name: 'INC D',
    ast: o.INC8('d')
  },
  //0x15:
  {
    name: 'DEC D',
    ast: o.DEC8('d')
  },
  //0x16:
  {
    name: 'LD D,n',
    ast: o.LD8('d'),
    operand: UINT8
  },
  //0x17:
  {
    name: 'RLA',
    ast: o.RLA()
  },
  //0x18:
  {
    name: 'JR (PC+e)',
    operand: INT8
  },
  //0x19:
  {
    name: 'ADD HL,DE',
    ast: o.ADD16('h', 'l', 'd', 'e')
  },
  //0x1A
  {
    name: 'LD A,(DE)',
    ast: o.LD8('a', 'd', 'e')
  },
  //0x1B
  {
    ame: 'DEC DE',
    ast: o.DEC16('d', 'e')
  },
  //0x1C
  {
    name: 'INC E',
    ast: o.INC8('e')
  },
  //0x1D
  {
    name: 'DEC E',
    ast: o.DEC8('e')
  },
  //0x1E
  {
    name: 'LD E,n',
    ast: o.LD8('e'),
    operand: UINT8
  },
  //0x1F
  {
    name: 'RRA',
    ast: o.RRA()
  },
  //0x20
  {
    name: 'JR NZ,(PC+e)',
    operand: INT8
  },
  //0x21
  {
    name: 'LD HL,nn',
    ast: o.LD16('h', 'l'),
    operand: UINT16
  },
  //0x22
  {
    name: 'LD (nn),HL',
    ast: o.LD_WRITE_MEM('n', 'n', 'h', 'l'),
    operand: UINT16
  },
  //0x23
  {
    name: 'INC HL',
    ast: o.INC16('h', 'l')
  },
  //0x24
  {
    name: 'INC H'
  },
  //0x25
  {
    name: 'DEC H'
  },
  //0x26
  {
    name: 'LD H,n',
    ast: o.LD8('h'),
    operand: UINT8
  },
  //0x27
  {
    name: 'DAA'
  },
  //0x28
  {
    name: 'JR Z,(PC+e)',
    operand: INT8
  },
  //0x29
  {
    name: 'ADD HL,HL',
    ast: o.ADD16('h', 'l', 'h', 'l')
  },
  //0x2A
  {
    name: 'LD HL,(nn)',
    ast: o.LD16('h', 'l', 'n', 'n'),
    operand: UINT16
  },
  //0x2B
  {
    name: 'DEC HL'
  },
  //0x2C
  {
    name: 'INC L'
  },
  //0x2D
  {
    name: 'DEC L'
  },
  //0x2E
  {
    name: 'LD L,n',
    ast: o.LD8('l'),
    operand: UINT8
  },
  //0x2F
  {
    name: 'CPL'
  },
  //0x30
  {
    name: 'JR NC,(PC+e)',
    operand: INT8
  },
  //0x31
  {
    name: 'LD SP,nn',
    ast: o.LD_SP(),
    operand: UINT16
  },
  //0x32
  {
    name: 'LD (nn),A',
    ast: o.LD_WRITE_MEM('n', 'n', 'a'),
    operand: UINT16
  },
  //0x33
  {
    name: 'INC SP'
  },
  //0x34
  {
    name: 'INC (HL)'
  },
  //0x35
  {
    name: 'DEC (HL)'
  },
  //0x36
  {
    name: 'LD (HL),n',
    ast: o.LD_WRITE_MEM('h', 'l'),
    operand: UINT8
  },
  //0x37
  {
    name: 'SCF'
  },
  //0x38
  {
    name: 'JR C,(PC+e)',
    operand: INT8
  },
  //0x39
  {
    name: 'ADD HL,SP'
  },
  //0x3A
  {
    name: 'LD A,(nn)',
    ast: o.LD8('a', 'n', 'n'),
    operand: UINT16
  },
  //0x3B
  {
    name: 'DEC SP'
  },
  //0x3C
  {
    name: 'INC A',
    ast: o.INC8('a')
  },
  //0x3D
  {
    name: 'DEC A',
    ast: o.DEC8('a')
  },
  //0x3E
  {
    name: 'LD A,n',
    ast: o.LD8('a'),
    operand: UINT8
  },
  //0x3F
  {
    name: 'CCF'
  },
  //0x40
  {
    name: 'LD B,B',
    ast: o.NOOP(),
    operand: UINT8
  },
  //0x41
  {
    name: 'LD B,C',
    ast: o.LD8('b', 'c')
  },
  //0x42
  {
    name: 'LD B,D',
    ast: o.LD8('b', 'd')
  },
  //0x43
  {
    name: 'LD B,E',
    ast: o.LD8('b', 'e')
  },
  //0x44
  {
    name: 'LD B,H',
    ast: o.LD8('b', 'h')
  },
  //0x45
  {
    name: 'LD B,L',
    ast: o.LD8('b', 'l')
  },
  //0x46
  {
    name: 'LD B,(HL)'
  },
  //0x47
  {
    name: 'LD B,A',
    ast: o.LD8('b', 'a')
  },
  //0x48
  {
    name: 'LD C,B',
    ast: o.LD8('c', 'b')
  },
  //0x49
  {
    name: 'LD C,C',
    ast: o.NOOP()
  },
  //0x4A
  {
    name: 'LD C,D',
    ast: o.LD8('c', 'd')
  },
  //0x4B
  {
    name: 'LD C,E',
    ast: o.LD8('c', 'e')
  },
  //0x4C
  {
    name: 'LD C,H',
    ast: o.LD8('c', 'h')
  },
  //0x4D
  {
    name: 'LD C,L',
    ast: o.LD8('c', 'l')
  },
  //0x4E
  {
    name: 'LD C,(HL)'
  },
  //0x4F
  {
    name: 'LD C,A',
    ast: o.LD8('c', 'a')
  },
  //0x50
  {
    name: 'LD D,B',
    ast: o.LD8('d', 'b')
  },
  //0x51
  {
    name: 'LD D,C',
    ast: o.LD8('d', 'c')
  },
  //0x52
  {
    name: 'LD D,D',
    ast: o.NOOP()
  },
  //0x53
  {
    name: 'LD D,E',
    ast: o.LD8('d', 'e')
  },
  //0x54
  {
    name: 'LD D,H',
    ast: o.LD8('d', 'h')
  },
  //0x55
  {
    name: 'LD D,L',
    ast: o.LD8('d', 'l')
  },
  //0x56
  {
    name: 'LD D,(HL)'
  },
  //0x57
  {
    name: 'LD D,A',
    ast: o.LD8('d', 'a')
  },
  //0x58
  {
    name: 'LD E,B',
    ast: o.LD8('e', 'b')
  },
  //0x59
  {
    name: 'LD E,C',
    ast: o.LD8('e', 'c')
  },
  //0x5A
  {
    name: 'LD E,D',
    ast: o.LD8('e', 'd')
  },
  //0x5B
  {
    name: 'LD E,E',
    ast: o.NOOP()
  },
  //0x5C
  {
    name: 'LD E,H',
    ast: o.LD8('e', 'h')
  },
  //0x5D
  {
    name: 'LD E,L',
    ast: o.LD8('e', 'l')
  },
  //0x5E
  {
    name: 'LD E,(HL)'
  },
  //0x5F
  {
    name: 'LD E,A',
    ast: o.LD8('e', 'a')
  },
  //0x60
  {
    name: 'LD H,B',
    ast: o.LD8('h', 'b')
  },
  //0x61
  {
    name: 'LD H,C',
    ast: o.LD8('h', 'c')
  },
  //0x62
  {
    name: 'LD H,D',
    ast: o.LD8('h', 'd')
  },
  //0x63
  {
    name: 'LD H,E',
    ast: o.LD8('h', 'e')
  },
  //0x64
  {
    name: 'LD H,H',
    ast: o.NOOP()
  },
  //0x65
  {
    name: 'LD H,L',
    ast: o.LD8('h', 'l')
  },
  //0x66
  {
    name: 'LD H,(HL)'
  },
  //0x67
  {
    name: 'LD H,A',
    ast: o.LD8('h', 'a')
  },
  //0x68
  {
    name: 'LD L,B',
    ast: o.LD8('l', 'b')
  },
  //0x69
  {
    name: 'LD L,C',
    ast: o.LD8('l', 'c')
  },
  //0x6A
  {
    name: 'LD L,D',
    ast: o.LD8('l', 'd')
  },
  //0x6B
  {
    name: 'LD L,E',
    ast: o.LD8('l', 'e')
  },
  //0x6C
  {
    name: 'LD L,H',
    ast: o.LD8('l', 'h')
  },
  //0x6D
  {
    name: 'LD L,L',
    ast: o.NOOP()
  },
  //0x6E
  {
    name: 'LD L,(HL)'
  },
  //0x6F
  {
    name: 'LD L,A',
    ast: o.LD8('l', 'a')
  },
  //0x70
  {
    name: 'LD (HL),B'
  },
  //0x71
  {
    name: 'LD (HL),C'
  },
  //0x72
  {
    name: 'LD (HL),D'
  },
  //0x73
  {
    name: 'LD (HL),E'
  },
  //0x74
  {
    name: 'LD (HL),H'
  },
  //0x75
  {
    name: 'LD (HL),L'
  },
  //0x76
  {
    name: 'HALT'
  },
  //0x77
  {
    name: 'LD (HL),A'
  },
  //0x78
  {
    name: 'LD A,B',
    ast: o.LD8('a', 'b')
  },
  //0x79
  {
    name: 'LD A,C',
    ast: o.LD8('a', 'c')
  },
  //0x7A
  {
    name: 'LD A,D',
    ast: o.LD8('a', 'd')
  },
  //0x7B
  {
    name: 'LD A,E',
    ast: o.LD8('a', 'e')
  },
  //0x7C
  {
    name: 'LD A,H',
    ast: o.LD8('a', 'h')
  },
  //0x7D
  {
    name: 'LD A,L',
    ast: o.LD8('a', 'l')
  },
  //0x7E
  {
    name: 'LD A,(HL)',
    ast: o.LD8('a', 'h', 'l')
  },
  //0x7F
  {
    name: 'LD A,A',
    ast: o.NOOP()
  },
  //0x80
  {
    name: 'ADD A,B',
    ast: o.ADD('b')
  },
  //0x81
  {
    name: 'ADD A,C',
    ast: o.ADD('c')
  },
  //0x82
  {
    name: 'ADD A,D',
    ast: o.ADD('d')
  },
  //0x83
  {
    name: 'ADD A,E',
    ast: o.ADD('e')
  },
  //0x84
  {
    name: 'ADD A,H',
    ast: o.ADD('h')
  },
  //0x85
  {
    name: 'ADD A,L',
    ast: o.ADD('l')
  },
  //0x86
  {
    name: 'ADD A,(HL)'
  },
  //0x87
  {
    name: 'ADD A,A',
    ast: o.ADD('a')
  },
  //0x88
  {
    name: 'ADC A,B'
  },
  //0x89
  {
    name: 'ADC A,C'
  },
  //0x8A
  {
    name: 'ADC A,D'
  },
  //0x8B
  {
    name: 'ADC A,E'
  },
  //0x8C
  {
    name: 'ADC A,H'
  },
  //0x8D
  {
    name: 'ADC A,L'
  },
  //0x8E
  {
    name: 'ADC A,(HL)'
  },
  //0x8F
  {
    name: 'ADC A,A'
  },
  //0x90
  {
    name: 'SUB A,B',
    ast: o.SUB('b')
  },
  //0x91
  {
    name: 'SUB A,C',
    ast: o.SUB('c')
  },
  //0x92
  {
    name: 'SUB A,D',
    ast: o.SUB('d')
  },
  //0x93
  {
    name: 'SUB A,E',
    ast: o.SUB('e')
  },
  //0x94
  {
    name: 'SUB A,H',
    ast: o.SUB('h')
  },
  //0x95
  {
    name: 'SUB A,L',
    ast: o.SUB('l')
  },
  //0x96
  {
    name: 'SUB A,(HL)'
  },
  //0x97
  {
    name: 'SUB A,A',
    ast: o.SUB('a')
  },
  //0x98
  {
    name: 'SBC A,B'
  },
  //0x99
  {
    name: 'SBC A,C'
  },
  //0x9A
  {
    name: 'SBC A,D'
  },
  //0x9B
  {
    name: 'SBC A,E'
  },
  //0x9C
  {
    name: 'SBC A,H'
  },
  //0x9D
  {
    name: 'SBC A,L'
  },
  //0x9E
  {
    name: 'SBC A,(HL)'
  },
  //0x9F
  {
    name: 'SBC A,A'
  },
  //0xA0
  {
    name: 'AND A,B',
    ast: o.AND('b')
  },
  //0xA1
  {
    name: 'AND A,C',
    ast: o.AND('c')
  },
  //0xA2
  {
    name: 'AND A,D',
    ast: o.AND('d')
  },
  //0xA3
  {
    name: 'AND A,E',
    ast: o.AND('e')
  },
  //0xA4
  {
    name: 'AND A,H',
    ast: o.AND('h')
  },
  //0xA5
  {
    name: 'AND A,L',
    ast: o.AND('l')
  },
  //0xA6
  {
    name: 'AND A,(HL)'
  },
  //0xA7
  {
    name: 'AND A,A',
    ast: o.AND('a')
  },
  //0xA8
  {
    name: 'XOR A,B',
    ast: o.XOR('b')
  },
  //0xA9
  {
    name: 'XOR A,C',
    ast: o.XOR('c')
  },
  //0xAA
  {
    name: 'XOR A,D',
    ast: o.XOR('d')
  },
  //0xAB
  {
    name: 'XOR A,E',
    ast: o.XOR('e')
  },
  //0xAC
  {
    name: 'XOR A,H',
    ast: o.XOR('h')
  },
  //0xAD
  {
    name: 'XOR A,L',
    ast: o.XOR('l')
  },
  //0xAE
  {
    name: 'XOR A,(HL)'
  },
  //0xAF
  {
    name: 'XOR A,A',
    ast: o.XOR('a')
  },
  //0xB0
  {
    name: 'OR A,B',
    ast: o.OR('b')
  },
  //0xB1
  {
    name: 'OR A,C',
    ast: o.OR('c')
  },
  //0xB2
  {
    name: 'OR A,D',
    ast: o.OR('d')
  },
  //0xB3
  {
    name: 'OR A,E',
    ast: o.OR('e')
  },
  //0xB4
  {
    name: 'OR A,H',
    ast: o.OR('h')
  },
  //0xB5
  {
    name: 'OR A,L',
    ast: o.OR('l')
  },
  //0xB6
  {
    name: 'OR A,(HL)'
  },
  //0xB7
  {
    name: 'OR A,A',
    ast: o.OR('a')
  },
  //0xB8
  {
    name: 'CP A,B'
  },
  //0xB9
  {
    name: 'CP A,C'
  },
  //0xBA
  {
    name: 'CP A,D'
  },
  //0xBB
  {
    name: 'CP A,E'
  },
  //0xBC
  {
    name: 'CP A,H'
  },
  //0xBD
  {
    name: 'CP A,L'
  },
  //0xBE
  {
    name: 'CP A,(HL)'
  },
  //0xBF
  {
    name: 'CP A,A'
  },
  //0xC0
  {
    name: 'RET NZ',
    ast: o.RET('==', F_ZERO)
  },
  //0xC1
  {
    name: 'POP BC'
  },
  //0xC2
  {
    name: 'JP NZ,(nn)',
    ast: o.JP('==', F_ZERO)
  },
  //0xC3
  {
    name: 'JP (nn)',
    ast: o.JP()
  },
  //0xC4
  {
    name: 'CALL NZ (nn)',
    ast: o.CALL('==', F_ZERO)
  },
  //0xC5
  {
    name: 'PUSH BC'
  },
  //0xC6
  {
    name: 'ADD A,n'
  },
  //0xC7
  {
    name: 'RST 00H',
    ast: o.RST(0x00)
  },
  //0xC8
  {
    name: 'RET Z',
    ast: o.RET('!=', F_ZERO)
  },
  //0xC9
  {
    name: 'RET',
    ast: o.RET()

  },
  //0xCA
  {
    name: 'JP Z,(nn)',
    ast: o.JP('!=', F_ZERO)
  },
  //0xCB
  {
    // CB Opcode
    name: ''
  },
  //0xCC
  {
    name: 'CALL Z (nn)',
    ast: o.CALL('!=', F_ZERO)
  },
  //0xCD
  {
    name: 'CALL (nn)',
    ast: o.CALL()
  },
  //0xCE
  {
    name: 'ADC A,n'
  },
  //0xCF
  {
    name: 'RST 08H',
    ast: o.RST(0x08)
  },
  //0xD0
  {
    name: 'RET NC',
    ast: o.RET('==', F_CARRY)
  },
  //0xD1
  {
    name: 'POP DE'
  },
  //0xD2
  {
    name: 'JP NC,(nn)',
    ast: o.JP('==', F_CARRY)
  },
  //0xD3
  {
    name: 'OUT (n),A'
  },
  //0xD4
  {
    name: 'CALL NC (nn)',
    ast: o.CALL('==', F_CARRY)
  },
  //0xD5
  {
    name: 'PUSH DE'
  },
  //0xD6
  {
    name: 'SUB n',
    ast: o.SUB()
  },
  //0xD7
  {
    name: 'RST 10H',
    ast: o.RST(0x10)
  },
  //0xD8
  {
    name: 'RET C',
    ast: o.RET('!=', F_CARRY)
  },
  //0xD9
  {
    name: 'EXX'
  },
  //0xDA
  {
    name: 'JP C,(nn)',
    ast: o.JP('!=', F_CARRY)
  },
  //0xDB
  {
    name: 'IN A,(n)'
  },
  //0xDC
  {
    name: 'CALL C (nn)',
    ast: o.CALL('!=', F_CARRY)
  },
  //0xDD
  {
    // DD Opcode
    name: ''
  },
  //0xDE
  {
    name: 'SBC A,n'
  },
  //0xDF
  {
    name: 'RST 18H',
    ast: o.RST(0x18)
  },
  //0xE0
  {
    name: 'RET PO',
    ast: o.RET('==', F_PARITY)
  },
  //0xE1
  {
    name: 'POP HL'
  },
  //0xE2
  {
    name: 'JP PO,(nn)',
    ast: o.JP('==', F_PARITY)
  },
  //0xE3
  {
    name: 'EX (SP),HL'
  },
  //0xE4
  {
    name: 'CALL PO (nn)',
    ast: o.CALL('==', F_PARITY)
  },
  //0xE5
  {
    name: 'PUSH HL'
  },
  //0xE6
  {
    name: 'AND (n)',
    ast: o.AND()
  },
  //0xE7
  {
    name: 'RST 20H',
    ast: o.RST(0x20)
  },
  //0xE8
  {
    name: 'RET PE',
    ast: o.RET('!=', F_PARITY)
  },
  //0xE9
  {
    name: 'JP (HL)'
  },
  //0xEA
  {
    name: 'JP PE,(nn)',
    ast: o.JP('!=', F_PARITY)
  },
  //0xEB
  {
    name: 'EX DE,HL'
  },
  //0xEC
  {
    name: 'CALL PE (nn)',
    ast: o.CALL('!=', F_PARITY)
  },
  //0xED
  {
    // ED Opcode
    name: ''
  },
  //0xEE
  {
    name: 'XOR n',
    ast: o.XOR()
  },
  //0xEF
  {
    name: 'RST 28H',
    ast: o.RST(0x28)
  },
  //0xF0
  {
    name: 'RET P',
    ast: o.RET('==', F_SIGN)
  },
  //0xF1
  {
    name: 'POP AF'
  },
  //0xF2
  {
    name: 'JP P,(nn)',
    ast: o.JP('==', F_SIGN)
  },
  //0xF3
  {
    name: 'DI'
  },
  //0xF4
  {
    name: 'CALL P (nn)',
    ast: o.CALL('==', F_SIGN)
  },
  //0xF5
  {
    name: 'PUSH AF'
  },
  //0xF6
  {
    name: 'OR n'
  },
  //0xF7
  {
    name: 'RST 30H',
    ast: o.RST(0x30)
  },
  //0xF8
  {
    name: 'RET M',
    ast: o.RET('!=', F_SIGN)
  },
  //0xF9
  {
    name: 'LD SP,HL'
  },
  //0xFA
  {
    name: 'JP M,(nn)',
    ast: o.JP('!=', F_SIGN)
  },
  //0xFB
  {
    name: 'EI'
  },
  //0xFC
  {
    name: 'CALL M (nn)',
    ast: o.CALL('!=', F_SIGN)
  },
  //0xFD
  {
    // FD Opcode
    name: ''
  },
  //0xFE
  {
    name: 'CP n'
  },
  //0xFF
  {
    name: 'RST 38H',
    ast: o.RST(0x38)
  }
];